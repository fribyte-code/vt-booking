/** Mixes a hex color with white. `amount` is the share of the original color (0–1). */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * amount + 255 * (1 - amount))
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix)
  return `rgb(${r} ${g} ${b})`
}
