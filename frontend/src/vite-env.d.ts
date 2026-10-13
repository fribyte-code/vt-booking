/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `demo` (mock data in localStorage) or `api` (Spring Boot backend). */
  readonly VITE_DATA_MODE: 'demo' | 'api'
  /** API mode: where "Prøv demo" on the login page leads. Unset in production, which hides the link. */
  readonly VITE_DEMO_URL?: string
  /** Demo mode: where "Til innlogging" leads, when the demo runs next to the real app. */
  readonly VITE_LOGIN_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
