/**
 * An email the admin sends from their own mail app: the app has no SMTP and sends nothing itself.
 * Every email in the app goes through `EmailDialog`, which shows it, copies it, or opens it.
 */
export interface EmailDraft {
  /** Empty when the admin fills in the recipient (e.g. the guards). */
  to: string
  subject: string
  /** Lines separated by `\n`. */
  body: string
}

/** A `mailto:` link with subject and text filled in (lines as CRLF, as mail apps expect). */
export function mailtoOf(e: EmailDraft): string {
  // The address is left as is (validated by the server); some mail apps don't decode %40.
  return `mailto:${e.to}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body.replace(/\n/g, '\r\n'))}`
}

/** What "Kopier e-post" puts on the clipboard: the subject, then the text. */
export function emailText(e: EmailDraft): string {
  return `Emne: ${e.subject}\n\n${e.body}`
}
