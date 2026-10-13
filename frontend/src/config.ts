/**
 * Build-time data mode, from `VITE_DATA_MODE` (see `.env*` and `vite.config.ts`).
 * Vite inlines the value, so `if (IS_DEMO)` branches and the modules only they
 * import are dropped from builds of the other mode.
 */
export const IS_DEMO = import.meta.env.VITE_DATA_MODE === 'demo'

/** API mode: link to the separate demo build, if this build has one next to it. */
export const DEMO_URL = import.meta.env.VITE_DEMO_URL || undefined

/** Demo mode: link back to the real app's login, if the demo runs next to it. */
export const LOGIN_URL = import.meta.env.VITE_LOGIN_URL || undefined
