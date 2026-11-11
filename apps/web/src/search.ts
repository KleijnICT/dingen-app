import type { Area, Project, Task } from '@dingen/core'

export type SearchHit =
  | { kind: 'task'; item: Task }
  | { kind: 'project'; item: Project }
  | { kind: 'area'; item: Area }

interface Source {
  tasks: readonly Task[]
  projects: readonly Project[]
  areas: readonly Area[]
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/**
 * Areas, open projects and open tasks whose title (or a task's notes) holds
 * every word of `query`, ignoring case and accents. Title matches come first.
 */
export function searchWorkspace(source: Source, query: string, limit = 30): SearchHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const has = (text: string) => {
    const f = fold(text)
    return words.every((w) => f.includes(w))
  }
  const ranked: { hit: SearchHit; rank: number }[] = []
  for (const item of source.areas) {
    if (has(item.title)) ranked.push({ hit: { kind: 'area', item }, rank: 0 })
  }
  for (const item of source.projects) {
    if (item.status === 'open' && has(item.title)) {
      ranked.push({ hit: { kind: 'project', item }, rank: 0 })
    }
  }
  for (const item of source.tasks) {
    if (item.status !== 'open') continue
    if (has(item.title)) ranked.push({ hit: { kind: 'task', item }, rank: 1 })
    else if (has(`${item.title} ${item.notes}`)) {
      ranked.push({ hit: { kind: 'task', item }, rank: 2 })
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => r.hit)
}
