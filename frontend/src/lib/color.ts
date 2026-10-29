/** Mixes a hex color with white. `amount` is the share of the original color (0–1). */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * amount + 255 * (1 - amount))
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix)
  return `rgb(${r} ${g} ${b})`
}

/** Suggested room colors, distinct from each other and readable with white text. */
export const ROOM_PALETTE = [
  '#2563eb',
  '#0891b2',
  '#0f766e',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#c026d3',
  '#7c3aed',
  '#4f46e5',
  '#334155',
]

export const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The first palette color nobody uses, or else the least used one. */
export function suggestColor(used: string[]): string {
  const count = (c: string) => used.filter((u) => sameColor(u, c)).length
  return ROOM_PALETTE.reduce((best, c) => (count(c) < count(best) ? c : best))
}
