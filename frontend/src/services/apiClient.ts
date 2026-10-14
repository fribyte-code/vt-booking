import { BookingError, type ConflictSlot } from './bookingError'
import type { ErrorCode } from './bookingRules'

/**
 * Minimal JSON client for the Spring Boot API. Requests always go to the same
 * origin (`/api/...`): Nginx proxies them in production and Vite in development,
 * so the session cookie is first-party and no CORS is needed.
 *
 * CSRF: Spring Security sets an `XSRF-TOKEN` cookie, which is echoed in an
 * `X-XSRF-TOKEN` header on every state-changing request. The token rotates on
 * login and logout (the cookie is cleared), so it is read fresh before each write
 * and fetched from `/api/auth/csrf` when missing.
 */

const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'

const KNOWN_CODES = new Set<ErrorCode>([
  'VALIDATION',
  'NOT_MEMBER',
  'NO_PERMISSION',
  'CONFLICT',
  'NOT_FOUND',
  'FORBIDDEN',
  'INVALID_STATE',
  'VERSION_CONFLICT',
  'RULE_VIOLATION',
  'UNAUTHENTICATED',
  'PASSWORD_CHANGE_REQUIRED',
])

export interface ApiClientDeps {
  fetch: typeof fetch
  readCookie: (name: string) => string | undefined
}

function browserCookie(name: string): string | undefined {
  const prefix = `${name}=`
  const entry = document.cookie.split('; ').find((c) => c.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : undefined
}

export function createApiClient(
  deps: ApiClientDeps = { fetch: (...args) => window.fetch(...args), readCookie: browserCookie },
) {
  async function send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await deps.fetch(path, { credentials: 'same-origin', ...init })
    } catch {
      throw new BookingError('NETWORK', 'Får ikke kontakt med serveren. Sjekk nettforbindelsen og prøv igjen.')
    }
  }

  async function csrfToken(): Promise<string> {
    let token = deps.readCookie(CSRF_COOKIE)
    if (!token) {
      await send('/api/auth/csrf', { method: 'GET' })
      token = deps.readCookie(CSRF_COOKIE)
    }
    if (!token) throw new BookingError('FORBIDDEN', 'Kunne ikke hente sikkerhetsnøkkel. Last inn siden på nytt.')
    return token
  }

  async function toError(res: Response): Promise<BookingError> {
    if (res.status === 401) return new BookingError('UNAUTHENTICATED', 'Du må logge inn.')

    let code: string | undefined
    let detail: string | undefined
    let conflicts: ConflictSlot[] | undefined
    try {
      const body = (await res.json()) as { code?: string; detail?: string; conflicts?: unknown }
      code = body.code
      detail = body.detail
      if (Array.isArray(body.conflicts)) conflicts = body.conflicts as ConflictSlot[]
    } catch {
      // Not Problem Details (e.g. a proxy error page).
    }
    if (code && KNOWN_CODES.has(code as ErrorCode) && detail) {
      return new BookingError(code as ErrorCode, detail, conflicts)
    }
    if (res.status === 403) return new BookingError('FORBIDDEN', 'Du har ikke tilgang til dette.')
    if (res.status === 404) return new BookingError('NOT_FOUND', 'Fant ikke det du lette etter.')
    return new BookingError('NETWORK', 'Serveren svarte med en feil. Prøv igjen om litt.')
  }

  async function hasProblemCode(res: Response): Promise<boolean> {
    try {
      return typeof ((await res.clone().json()) as { code?: unknown }).code === 'string'
    } catch {
      return false
    }
  }

  /** Sends a state-changing request with the CSRF header, retrying once if the token was stale. */
  async function write(path: string, init: RequestInit): Promise<Response> {
    const attempt = async () =>
      send(path, { ...init, headers: { ...init.headers, [CSRF_HEADER]: await csrfToken() } })
    let res = await attempt()
    if (res.status === 403 && !(await hasProblemCode(res))) {
      // A domain 403 carries a `code`; a rejected CSRF token does not. Fetch a fresh token and retry once.
      await send('/api/auth/csrf', { method: 'GET' })
      res = await attempt()
    }
    return res
  }

  function writeJson(method: string, path: string, body?: unknown): Promise<Response> {
    return write(path, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) throw await toError(res)
    return (await res.json()) as T
  }

  return {
    async get<T>(path: string): Promise<T> {
      return json<T>(await send(path, { method: 'GET', headers: { Accept: 'application/json' } }))
    },

    async post<T>(path: string, body?: unknown): Promise<T> {
      return json<T>(await writeJson('POST', path, body))
    },

    async put<T>(path: string, body: unknown): Promise<T> {
      return json<T>(await writeJson('PUT', path, body))
    },

    async patch<T>(path: string, body: unknown): Promise<T> {
      return json<T>(await writeJson('PATCH', path, body))
    },

    /** POST or DELETE that answers 204 No Content. */
    async send(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> {
      const res = await writeJson(method, path, body)
      if (!res.ok) throw await toError(res)
    },

    /** Form login (`/api/auth/login`). Wrong credentials and disabled accounts both give 401; too many failures 429. */
    async login(email: string, password: string): Promise<void> {
      const res = await write('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, password }).toString(),
      })
      if (res.status === 401) throw new BookingError('UNAUTHENTICATED', 'Feil e-post eller passord.')
      if (res.status === 429) {
        throw new BookingError('FORBIDDEN', 'For mange mislykkede forsøk. Vent et kvarter og prøv igjen.')
      }
      if (!res.ok) throw await toError(res)
    },

    async logout(): Promise<void> {
      const res = await write('/api/auth/logout', { method: 'POST' })
      if (!res.ok && res.status !== 401) throw await toError(res)
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
