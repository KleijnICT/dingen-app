/** The invitation secret from a link like `https://host/?invite=…`, or null. */
export function inviteFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('invite')?.trim()
  return value ? value : null
}

/** The same URL without the invitation, so it does not linger in the address bar. */
export function withoutInvite(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('invite')
  return url.pathname + url.search + url.hash
}

/** The link to hand out for an invitation secret. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/?invite=${encodeURIComponent(token)}`
}
