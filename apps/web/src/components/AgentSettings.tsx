import {
  AGENT_LEVELS,
  type Agent,
  type AgentGrant,
  type AgentLevel,
  type AgentScope,
  AREA_COLORS,
  AREA_ICONS,
  type Member,
  memberId,
  views,
} from '@dingen/core'
import { Infinity as EverythingIcon, Inbox, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import {
  agentsApi,
  parseScopeKey,
  refreshAgents,
  scopeKey,
  sortGrants,
  useAgents,
  withGrant,
} from '../agents.js'
import { errorText } from '../api.js'
import { formatDate, type MessageKey, useT } from '../i18n/index.js'
import { useWorkspace } from '../store/context.js'
import { AreaGlyph, areaColorVar } from './AreaIcons.js'
import { ProgressCircle } from './Icons.js'
import { MemberAvatar } from './MemberAvatar.js'
import { MoreMenu } from './Menu.js'

/** An agent as a member, for its avatar. */
export function agentMember(a: Pick<Agent, 'id' | 'name' | 'icon' | 'color'>): Member {
  return { id: memberId.agent(a.id), kind: 'agent', name: a.name, icon: a.icon, color: a.color }
}

/** The name of a scope: Everything, Inbox, or the area's or project's title. */
export function useScopeLabel(): (s: AgentScope) => string {
  const t = useT()
  const ws = useWorkspace()
  return (s) => {
    switch (s.scope) {
      case 'all':
        return t('agents.scope.all')
      case 'inbox':
        return t('agents.scope.inbox')
      case 'area': {
        const area = ws.areaById.get(s.id)
        return area ? area.title || t('area.untitled') : t('agents.scope.gone')
      }
      case 'project': {
        const project = ws.projectById.get(s.id)
        return project ? project.title || t('project.untitled') : t('agents.scope.gone')
      }
    }
  }
}

function ScopeIcon({ scope }: { scope: AgentScope }) {
  const ws = useWorkspace()
  if (scope.scope === 'all') return <EverythingIcon size={16} aria-hidden="true" />
  if (scope.scope === 'inbox') return <Inbox size={16} aria-hidden="true" />
  if (scope.scope === 'area') {
    const area = ws.areaById.get(scope.id)
    return <AreaGlyph icon={area?.icon ?? null} color={area?.color ?? null} size={16} />
  }
  return <ProgressCircle value={views.progress(scope.id, ws.tasks)} size={15} />
}

type Fresh = { name: string; token: string }

/** Settings → Agents: the agents that work in your data, with their access and tokens. */
export function AgentSettings() {
  const t = useT()
  const agents = useAgents()
  const label = useScopeLabel()
  const [editing, setEditing] = useState<Agent | 'new' | null>(null)
  const [fresh, setFresh] = useState<Fresh | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const rotate = (agent: Agent) =>
    run(async () => {
      const { token } = await agentsApi.rotate(agent.id)
      setFresh({ name: agent.name, token })
      await refreshAgents()
    })
  const revoke = (agent: Agent) =>
    run(async () => {
      await agentsApi.revoke(agent.id)
      if (fresh?.name === agent.name) setFresh(null)
      await refreshAgents()
    })

  if (editing) {
    return (
      <AgentEditor
        agent={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={(token, name) => {
          setEditing(null)
          if (token) setFresh({ name, token })
        }}
      />
    )
  }

  const summary = (agent: Agent) =>
    agent.grants.length === 0
      ? t('agents.noAccess')
      : sortGrants(agent.grants)
          .map((g) => `${label(g)} (${t(`agents.level.${g.level}`)})`)
          .join(', ')

  return (
    <div className="settings-form agents-settings">
      <p className="muted">{t('agents.intro')}</p>
      <p className="muted">{t('agents.mcpHelp', { url: `${window.location.origin}/mcp` })}</p>
      <div>
        <button type="button" onClick={() => setEditing('new')}>
          {t('agents.new')}
        </button>
      </div>
      {fresh && <TokenReveal fresh={fresh} onDone={() => setFresh(null)} />}
      {error && <p className="error">{error}</p>}
      <ul className="agent-list">
        {agents.length === 0 && <li className="muted">{t('agents.none')}</li>}
        {agents.map((agent) => (
          <li key={agent.id} className="agent-item">
            <MemberAvatar member={agentMember(agent)} size={30} title={false} />
            <button type="button" className="agent-main" onClick={() => setEditing(agent)}>
              <strong>{agent.name}</strong>
              <span className="muted agent-scopes">{summary(agent)}</span>
              <span className="muted agent-used">
                {agent.lastUsedAt
                  ? t('agents.lastUsed', {
                      date: formatDate(new Date(agent.lastUsedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })
                  : t('agents.unused')}
                {agent.tokenPrefix && (
                  <>
                    {' · '}
                    <code>{agent.tokenPrefix}…</code>
                  </>
                )}
              </span>
            </button>
            <MoreMenu
              alignEnd
              label={t('agents.actions', { name: agent.name })}
              items={[
                { label: t('agents.edit'), onSelect: () => setEditing(agent) },
                {
                  label: t('agents.rotate'),
                  confirm: t('agents.rotateQuestion', { name: agent.name }),
                  onSelect: () => void rotate(agent),
                },
                {
                  label: t('agents.revoke'),
                  danger: true,
                  confirm: t('agents.revokeQuestion', { name: agent.name }),
                  onSelect: () => void revoke(agent),
                },
              ]}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The token, shown once after creating or renewing, with copy and how to connect. */
function TokenReveal({ fresh, onDone }: { fresh: Fresh; onDone: () => void }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const command = `claude mcp add --transport http dingen ${window.location.origin}/mcp --header "Authorization: Bearer ${fresh.token}"`

  async function copy() {
    try {
      await navigator.clipboard.writeText(fresh.token)
      setCopied(true)
    } catch {
      // Clipboard not available (e.g. plain HTTP): the token is selectable by hand.
      setCopied(false)
    }
  }

  return (
    <div className="token-reveal" role="status">
      <p>{t('agents.token.reveal', { name: fresh.name })}</p>
      <code>{fresh.token}</code>
      <div className="row agent-token-actions">
        <button type="button" onClick={copy}>
          {copied ? t('agents.token.copied') : t('agents.token.copy')}
        </button>
        <button type="button" className="link" onClick={onDone}>
          {t('agents.token.done')}
        </button>
      </div>
      <p className="muted">{t('agents.token.command')}</p>
      <code className="agent-command">{command}</code>
    </div>
  )
}

interface EditorProps {
  agent: Agent | null
  onCancel: () => void
  onSaved: (token: string | null, name: string) => void
}

/** Create or edit an agent: name, look and access. */
function AgentEditor({ agent, onCancel, onSaved }: EditorProps) {
  const t = useT()
  const ws = useWorkspace()
  const label = useScopeLabel()
  const [name, setName] = useState(agent?.name ?? '')
  const [icon, setIcon] = useState(agent?.icon ?? 'bot')
  const [color, setColor] = useState(agent?.color ?? 'gray')
  const [grants, setGrants] = useState<AgentGrant[]>(agent ? sortGrants(agent.grants) : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const taken = new Set(grants.map(scopeKey))
  const areas = views.openAreas(ws.areas)
  const looseProjects = views.projectsOf(ws.projects, null)
  const option = (s: AgentScope, text: string) => (
    <option key={scopeKey(s)} value={scopeKey(s)} disabled={taken.has(scopeKey(s))}>
      {text}
    </option>
  )

  function setLevel(s: AgentScope, level: AgentLevel | null) {
    setGrants((g) => withGrant(g, s, level))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const input = { name: name.trim(), icon, color, grants }
    if (!input.name) return
    setBusy(true)
    setError(null)
    try {
      if (agent) {
        await agentsApi.update(agent.id, input)
        await refreshAgents()
        onSaved(null, input.name)
      } else {
        const { token } = await agentsApi.create(input)
        await refreshAgents()
        onSaved(token, input.name)
      }
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form className="settings-form agent-editor" onSubmit={save}>
      <h2>{agent ? t('agents.editTitle') : t('agents.newTitle')}</h2>
      <label className="settings-field agent-name">
        <span>{t('agents.name')}</span>
        <input
          type="text"
          value={name}
          placeholder={t('agents.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          // biome-ignore lint/a11y/noAutofocus: the first field of a form the user just opened
          autoFocus
        />
      </label>

      <fieldset className="agent-look">
        <legend>{t('agents.look')}</legend>
        <div className="agent-look-preview">
          <MemberAvatar
            member={agentMember({ id: 'preview', name: name || t('agents.new'), icon, color })}
            size={40}
            title={false}
          />
        </div>
        <div className="icon-grid">
          {AREA_ICONS.map((id) => (
            <button
              key={id}
              type="button"
              className="picker-item"
              aria-label={t(`areaIcon.${id}` as MessageKey)}
              title={t(`areaIcon.${id}` as MessageKey)}
              aria-pressed={icon === id}
              onClick={() => setIcon(id)}
            >
              <AreaGlyph icon={id} color={color} />
            </button>
          ))}
        </div>
        <div className="color-row">
          {AREA_COLORS.map((id) => (
            <button
              key={id}
              type="button"
              className="swatch"
              style={{ background: areaColorVar(id) }}
              aria-label={t(`areaColor.${id}` as MessageKey)}
              title={t(`areaColor.${id}` as MessageKey)}
              aria-pressed={color === id}
              onClick={() => setColor(id)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="agent-access">
        <legend>{t('agents.access')}</legend>
        <p className="muted">{t('agents.accessHelp')}</p>
        <ul className="agent-grants">
          {grants.length === 0 && <li className="muted">{t('agents.noAccess')}</li>}
          {grants.map((g) => (
            <li key={scopeKey(g)} className="agent-grant">
              <span className="agent-grant-icon">
                <ScopeIcon scope={g} />
              </span>
              <span className="agent-grant-name">{label(g)}</span>
              <select
                value={g.level}
                aria-label={t('agents.levelFor', { scope: label(g) })}
                onChange={(e) => setLevel(g, e.target.value as AgentLevel)}
              >
                {AGENT_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`agents.level.${level}`)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="agent-grant-remove"
                aria-label={t('agents.removeScope', { scope: label(g) })}
                title={t('agents.removeScope', { scope: label(g) })}
                onClick={() => setLevel(g, null)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <select
          className="agent-add-scope"
          value=""
          aria-label={t('agents.addScope')}
          onChange={(e) => {
            const s = parseScopeKey(e.target.value)
            if (s) setLevel(s, 'read')
          }}
        >
          <option value="">{t('agents.addScope')}</option>
          {option({ scope: 'all' }, t('agents.scope.all'))}
          {option({ scope: 'inbox' }, t('agents.scope.inbox'))}
          {looseProjects.length > 0 && (
            <optgroup label={t('move.projects')}>
              {looseProjects.map((p) =>
                option({ scope: 'project', id: p.id }, p.title || t('project.untitled')),
              )}
            </optgroup>
          )}
          {areas.map((a) => (
            <optgroup key={a.id} label={a.title || t('area.untitled')}>
              {option({ scope: 'area', id: a.id }, a.title || t('area.untitled'))}
              {views
                .projectsOf(ws.projects, a.id)
                .map((p) =>
                  option({ scope: 'project', id: p.id }, `  ${p.title || t('project.untitled')}`),
                )}
            </optgroup>
          ))}
        </select>
        <dl className="agent-levels muted">
          {AGENT_LEVELS.map((level) => (
            <div key={level}>
              <dt>{t(`agents.level.${level}`)}</dt>
              <dd>{t(`agents.levelHelp.${level}`)}</dd>
            </div>
          ))}
        </dl>
      </fieldset>

      {error && <p className="error">{error}</p>}
      <div className="row agent-editor-foot">
        <button type="button" className="link" onClick={onCancel} disabled={busy}>
          {t('confirm.cancel')}
        </button>
        <button type="submit" disabled={busy || !name.trim()}>
          {agent ? t('agents.save') : t('agents.create')}
        </button>
      </div>
    </form>
  )
}
