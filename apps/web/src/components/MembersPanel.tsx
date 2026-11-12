import { AGENT_LEVELS, type AgentLevel, type AgentScope, levelFor } from '@dingen/core'
import { useCallback, useEffect, useState } from 'react'
import {
  type AccessEntry,
  type AccessType,
  agentsApi,
  directGrant,
  inheritedLevel,
  levelsFrom,
  placeOfContainer,
  refreshAgents,
  sameScope,
  useAgents,
  withGrant,
} from '../agents.js'
import { errorText } from '../api.js'
import { useT } from '../i18n/index.js'
import { useWorkspace } from '../store/context.js'
import { useScopeLabel } from './AgentSettings.js'
import { MemberAvatar, useMembers } from './MemberAvatar.js'

export interface Access {
  entries: AccessEntry[]
  reload: () => void
}

/**
 * Who can reach this area or project (`GET /api/access`). Loads again when the
 * agents change (their grants decide it) or on `reload`.
 */
export function useAccess(type: AccessType, id: string): Access {
  const agents = useAgents()
  const [entries, setEntries] = useState<AccessEntry[]>([])
  const [version, setVersion] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: agents and version force a reload
  useEffect(() => {
    let alive = true
    agentsApi
      .access(type, id)
      .then((m) => {
        if (alive) setEntries(m)
      })
      .catch(() => {
        if (alive) setEntries([])
      })
    return () => {
      alive = false
    }
  }, [type, id, agents, version])
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { entries, reload }
}

/** Small avatars next to the title, only when at least one agent can reach the place. */
export function MemberAvatars({ entries }: { entries: AccessEntry[] }) {
  const t = useT()
  const { byId } = useMembers()
  if (!entries.some((e) => e.member.startsWith('agent:'))) return null
  return (
    <span className="member-stack" title={t('members.title')}>
      {entries.map((e) => (
        <MemberAvatar key={e.member} member={byId(e.member)} fallbackId={e.member} size={22} />
      ))}
    </span>
  )
}

interface PanelProps {
  type: AccessType
  id: string
  access: Access
}

/**
 * The "Members" panel in the `…` menu of a project or area: you and the agents
 * that can reach it, with their level. Changing a level or adding an agent
 * edits that agent's grants for this place.
 */
export function MembersPanel({ type, id, access }: PanelProps) {
  const t = useT()
  const ws = useWorkspace()
  const label = useScopeLabel()
  const agents = useAgents()
  const { byId } = useMembers()
  const [adding, setAdding] = useState('')
  const [addLevel, setAddLevel] = useState<AgentLevel>('edit')
  const [error, setError] = useState<string | null>(null)

  const scope: AgentScope = { scope: type, id }
  const place = placeOfContainer(type, id, ws.projectById)
  const present = new Set<string>(access.entries.map((e) => e.member))
  const addable = agents.filter((a) => !present.has(`agent:${a.id}`))

  async function setLevel(agentId: string, level: AgentLevel | null) {
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) return
    setError(null)
    try {
      await agentsApi.update(agent.id, { grants: withGrant(agent.grants, scope, level) })
      // New agent grants make `useAccess` load the members again.
      await refreshAgents()
    } catch (err) {
      setError(errorText(err))
    }
  }

  /** "via Everything" or "via <area>" when the level comes from another grant. */
  function via(agentId: string, level: AgentLevel): string | null {
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) return null
    const best = agent.grants
      .filter((g) => !sameScope(g, scope) && levelFor([g], place) !== null)
      .sort((a, b) => AGENT_LEVELS.indexOf(b.level) - AGENT_LEVELS.indexOf(a.level))[0]
    return best && best.level === level ? t('members.via', { scope: label(best) }) : null
  }

  return (
    <div className="members-panel">
      <ul className="members-list">
        {access.entries.map((entry) => {
          const agentId = entry.member.startsWith('agent:') ? entry.member.slice(6) : null
          const agent = agentId ? agents.find((a) => a.id === agentId) : undefined
          const member = byId(entry.member)
          const name = member?.name ?? entry.member
          return (
            <li key={entry.member} className="members-row">
              <MemberAvatar member={member} fallbackId={entry.member} size={24} title={false} />
              <span className="members-name">
                <span>{agentId ? name : t('members.you', { name })}</span>
                {agentId && via(agentId, entry.level) && (
                  <span className="muted">{via(agentId, entry.level)}</span>
                )}
              </span>
              {agent ? (
                <AgentLevelSelect
                  name={name}
                  level={entry.level}
                  floor={inheritedLevel(agent.grants, scope, place)}
                  removable={directGrant(agent.grants, scope) !== null}
                  onChange={(level) => void setLevel(agent.id, level)}
                />
              ) : (
                <span className="members-level muted">{t(`agents.level.${entry.level}`)}</span>
              )}
            </li>
          )
        })}
      </ul>
      {agents.length === 0 ? (
        <p className="muted members-hint">{t('members.noAgents')}</p>
      ) : addable.length > 0 ? (
        <div className="members-add">
          <select
            value={adding}
            aria-label={t('members.addAgent')}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">{t('members.addAgent')}</option>
            {addable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={addLevel}
            aria-label={t('members.level')}
            onChange={(e) => setAddLevel(e.target.value as AgentLevel)}
          >
            {AGENT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t(`agents.level.${level}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              const agentId = adding
              setAdding('')
              void setLevel(agentId, addLevel)
            }}
          >
            {t('members.add')}
          </button>
        </div>
      ) : null}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

interface SelectProps {
  name: string
  level: AgentLevel
  /** The level the agent keeps anyway through another grant; lower levels are not offered. */
  floor: AgentLevel | null
  /** Has a grant for exactly this place, so it can be taken away here. */
  removable: boolean
  onChange: (level: AgentLevel | null) => void
}

function AgentLevelSelect({ name, level, floor, removable, onChange }: SelectProps) {
  const t = useT()
  return (
    <select
      className="members-level"
      value={level}
      aria-label={t('members.levelOf', { name })}
      onChange={(e) =>
        onChange(e.target.value === 'remove' ? null : (e.target.value as AgentLevel))
      }
    >
      {levelsFrom(floor).map((l) => (
        <option key={l} value={l}>
          {t(`agents.level.${l}`)}
        </option>
      ))}
      {removable && <option value="remove">{t('members.remove')}</option>}
    </select>
  )
}
