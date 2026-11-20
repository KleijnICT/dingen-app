/** The reset secret from a link like `https://host/?reset=…`, or null. */
export function resetFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('reset')?.trim()
  return value ? value : null
}

/** The same URL without the reset secret, so it does not linger in the address bar. */
export function withoutReset(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('reset')
  return url.pathname + url.search + url.hash
}

/** The link to pass on for a reset secret (an administrator's reset link). */
export function resetLink(origin: string, token: string): string {
  return `${origin}/?reset=${encodeURIComponent(token)}`
}
