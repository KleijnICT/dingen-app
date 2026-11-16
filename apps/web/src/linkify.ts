/** A piece of text: plain, or a link with the address it opens (always http or https). */
export type LinkToken =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

const URL_START = /(?:https?:\/\/|www\.)[^\s<>"]+/gi
const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** Cuts trailing punctuation and closing brackets that have no opening one inside the link. */
function trimEnd(url: string): string {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1] as string
    if (/[.,;:!?'"*_~]/.test(ch)) {
      end--
      continue
    }
    const open = PAIRS[ch]
    if (open) {
      const body = url.slice(0, end)
      const opens = body.split(open).length - 1
      const closes = body.split(ch).length - 1
      if (closes > opens) {
        end--
        continue
      }
    }
    break
  }
  return url.slice(0, end)
}

/** The address a link opens, or null when it is not a plain http(s) address. */
function hrefOf(text: string): string | null {
  const href = /^www\./i.test(text) ? `https://${text}` : text
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.hostname.includes('.') || url.hostname === 'localhost' ? href : null
  } catch {
    return null
  }
}

/**
 * Splits notes into text and link tokens. Joining every token's `text` gives the input back,
 * so line breaks and spacing stay. Only http(s) links and bare www. addresses count.
 */
export function tokenizeLinks(input: string): LinkToken[] {
  const tokens: LinkToken[] = []
  let last = 0
  const push = (text: string) => {
    if (!text) return
    const prev = tokens[tokens.length - 1]
    if (prev?.type === 'text') prev.text += text
    else tokens.push({ type: 'text', text })
  }
  for (const m of input.matchAll(URL_START)) {
    const at = m.index ?? 0
    // "awww.example.com" is a word, not a link.
    if (at < last || (/^www/i.test(m[0]) && /\w/.test(input[at - 1] ?? ''))) continue
    const text = trimEnd(m[0])
    const href = hrefOf(text)
    if (!href) continue
    push(input.slice(last, at))
    tokens.push({ type: 'link', text, href })
    last = at + text.length
  }
  push(input.slice(last))
  return tokens
}

/** Whether the text holds at least one link. */
export function hasLinks(input: string): boolean {
  return tokenizeLinks(input).some((t) => t.type === 'link')
}
