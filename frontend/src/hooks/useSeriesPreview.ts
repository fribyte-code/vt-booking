import { useEffect, useState } from 'react'
import { errorMessage } from '../lib/errors'
import type { CreateSeriesInput, SeriesPreviewOccurrence } from '../types'
import { useApp } from './useApp'

interface PreviewState {
  key: string
  occurrences?: SeriesPreviewOccurrence[]
  error?: string
}

/**
 * Asks the data source which dates a weekly series would get and which are taken, a moment after
 * the input stops changing. `null` input means there is nothing to preview.
 */
export function useSeriesPreview(input: CreateSeriesInput | null) {
  const { previewSeries } = useApp()
  const key = input ? JSON.stringify(input) : null
  const [state, setState] = useState<PreviewState | null>(null)

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const timer = setTimeout(() => {
      previewSeries(JSON.parse(key) as CreateSeriesInput).then(
        (occurrences) => !cancelled && setState({ key, occurrences }),
        (err: unknown) => !cancelled && setState({ key, error: errorMessage(err) }),
      )
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, previewSeries])

  const current = state?.key === key ? state : null
  return { occurrences: current?.occurrences, error: current?.error, loading: !!key && !current }
}
