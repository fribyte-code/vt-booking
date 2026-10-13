import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../../lib/errors'

/** Loads data for a management page, with reload after changes. */
export function useAdminData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    load().then(
      (next) => {
        if (!cancelled) {
          setData(next)
          setError(null)
        }
      },
      (err: unknown) => !cancelled && setError(errorMessage(err)),
    )
    return () => {
      cancelled = true
    }
  }, [load, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { data, error, reload }
}
