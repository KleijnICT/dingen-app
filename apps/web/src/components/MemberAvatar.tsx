import type { Member, MemberId } from '@dingen/core'
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { AreaGlyph, areaColorVar } from './AreaIcons.js'

/**
 * Members (plan 19): people get their initials in a circle, agents their icon
 * in a rounded square, so the two are told apart at a glance.
 */

let cache: Promise<Member[]> | null = null
let current: Member[] | null = null
const listeners = new Set<() => void>()

/** All members of the signed-in user (`GET /api/members`), fetched once per page load. */
export function loadMembers(refresh = false): Promise<Member[]> {
  if (!cache || refresh) {
    cache = api
      .get<{ members: Member[] }>('/api/members')
      .then((r) => r.members)
      .catch(() => {
        cache = null
        return []
      })
    void cache.then((members) => {
      current = members
      for (const l of listeners) l()
    })
  }
  return cache
}

/** The members, and a lookup by id; follows `loadMembers(true)`. */
export function useMembers(): {
  members: Member[]
  byId: (id: string | null) => Member | undefined
} {
  const [members, setMembers] = useState<Member[]>(current ?? [])
  useEffect(() => {
    const update = () => setMembers(current ?? [])
    listeners.add(update)
    void loadMembers().then(update)
    return () => {
      listeners.delete(update)
    }
  }, [])
  return { members, byId: (id) => (id ? members.find((m) => m.id === id) : undefined) }
}

function initials(name: string): string {
  const words = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
  const letters =
    words.length > 1 ? `${words[0]?.[0]}${words[1]?.[0]}` : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

interface Props {
  member: Member | undefined
  /** Shown while the member is unknown (e.g. still loading). */
  fallbackId?: MemberId | string | null
  size?: number
  /** Adds the name as tooltip and accessible label. */
  title?: boolean
}

export function MemberAvatar({ member, fallbackId, size = 20, title = true }: Props) {
  const label = member?.name ?? fallbackId ?? ''
  const common = {
    className: `member-avatar ${member?.kind === 'agent' || fallbackId?.startsWith('agent:') ? 'agent' : 'user'}`,
    style: { width: size, height: size, fontSize: Math.round(size * 0.42) },
    ...(title ? { title: label, 'aria-label': label } : { 'aria-hidden': true as const }),
  }
  if (member?.kind === 'agent') {
    return (
      <span {...common} style={{ ...common.style, color: areaColorVar(member.color) }}>
        <AreaGlyph icon={member.icon} color={member.color} size={Math.round(size * 0.65)} />
      </span>
    )
  }
  return <span {...common}>{initials(label)}</span>
}
