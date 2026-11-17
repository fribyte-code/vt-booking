/**
 * The first letter of the first two words that start with a letter, so "Patrik (friByte)" gives "P",
 * not "P(". A name with no such word falls back to its first character.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/)
  const letters = words.filter((w) => /^\p{L}/u.test(w)).map((w) => Array.from(w)[0])
  const initials = letters.length > 0 ? letters.slice(0, 2) : Array.from(name.trim()).slice(0, 1)
  return initials.join('').toLocaleUpperCase('nb')
}
