import { type ActivityItem, type Member, SYSTEM_ACTOR } from '@dingen/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  actorName,
  describeLine,
  groupByDay,
  KIND_FILTERS,
  type KindFilter,
  kindsFor,
  mergeFresh,
  PERIOD_FILTERS,
  type PeriodFilter,
  sinceFor,
} from '../activity.js'
import { type ActivityFilter, fetchActivity, type User } from '../api.js'
import { formatDate, useT } from '../i18n/index.js'
import { describeDate, type ListDef } from '../lists.js'
import { areaPath, navigate, projectPath, taskPath } from '../router.js'
import { useWorkspace } from '../store/context.js'
import { ListPage } from './ListPage.js'
import { MemberAvatar, useMembers } from './MemberAvatar.js'
import { pathOf } from './Search.js'

const PAGE = 50
/** Pages fetched in a row when a narrow filter keeps coming back empty. */
const MAX_EMPTY_PAGES = 5

interface Props {
  list: ListDef
  user: User
  focusSignal: number
}

/**
 * The Logbook (plan 19): everything that happened, newest first and grouped per
 * day, by you and by your agents. "Completed" shows the familiar list of
 * completed items, which can be reopened from there.
 */
export function LogbookPage({ list, user, focusSignal }: Props) {
  const t = useT()
  const [kind, setKind] = useState<KindFilter>('all')
  const [who, setWho] = useState('')
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const { members, byId } = useMembers()
  const me = `user:${user.id}`

  const header = (
    <header className="list-header">
      <h1>{t(list.titleKey)}</h1>
      <div className="activity-filters">
        <fieldset className="view-switch" aria-label={t('activity.filters')}>
          {KIND_FILTERS.map((k) => (
            <button
              type="button"
              key={k}
              className={`chip small ${kind === k ? 'active' : ''}`}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {t(`activity.kind.${k}`)}
            </button>
          ))}
        </fieldset>
        {kind !== 'completed' && (
          <div className="activity-selects">
            <select
              className="move-select"
              aria-label={t('activity.who')}
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              <option value="">{t('activity.who.all')}</option>
              <option value={me}>{t('activity.you')}</option>
              {members
                .filter((m) => m.id !== me)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <select
              className="move-select"
              aria-label={t('activity.period')}
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
            >
              {PERIOD_FILTERS.map((p) => (
                <option key={p} value={p}>
                  {t(`activity.period.${p}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </header>
  )

  if (kind === 'completed') {
    return <ListPage list={list} focusSignal={focusSignal} header={header} />
  }
  return (
    <section className="list-page logbook activity">
      {header}
      <ActivityList
        filter={{ kinds: kindsFor(kind), actor: who || undefined, period }}
        me={me}
        owner={{ id: me as Member['id'], kind: 'user', name: user.email, icon: null, color: null }}
        byId={byId}
      />
    </section>
  )
}

interface ListProps {
  filter: { kinds: ActivityFilter['kinds']; actor: string | undefined; period: PeriodFilter }
  me: string
  owner: Member
  byId: (id: string | null) => Member | undefined
}

function ActivityList({ filter, me, owner, byId }: ListProps) {
  const t = useT()
  const ws = useWorkspace()
  const [items, setItems] = useState<ActivityItem[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const sentinel = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const loaded = useRef({ items, next })
  loaded.current = { items, next }

  const kindsKey = filter.kinds?.join(',') ?? ''
  const since = sinceFor(filter.period, ws.today)
  const query = useCallback(
    (before?: number): ActivityFilter => ({
      kinds: kindsKey ? (kindsKey.split(',') as ActivityFilter['kinds']) : undefined,
      actor: filter.actor,
      since,
      before,
      limit: PAGE,
    }),
    [kindsKey, filter.actor, since],
  )

  // A new filter (or "Try again") starts over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only re-runs the load
  useEffect(() => {
    let alive = true
    setState('loading')
    setItems([])
    setNext(null)
    busy.current = true
    void (async () => {
      try {
        let page = await fetchActivity(query())
        let got = page.items
        // Narrow filters can come back empty with a cursor; read on a little.
        for (let i = 1; got.length === 0 && page.nextBefore !== null && i < MAX_EMPTY_PAGES; i++) {
          page = await fetchActivity(query(page.nextBefore))
          got = page.items
        }
        if (!alive) return
        setItems(got)
        setNext(page.nextBefore)
        setState('idle')
      } catch {
        if (alive) setState('error')
      } finally {
        busy.current = false
      }
    })()
    return () => {
      alive = false
    }
  }, [query, attempt])

  const loadMore = useCallback(async () => {
    const { next: before } = loaded.current
    if (busy.current || before === null) return
    busy.current = true
    try {
      const page = await fetchActivity(query(before))
      setItems((prev) => [...prev, ...page.items.filter((i) => i.seq < before)])
      setNext(page.nextBefore)
    } catch {
      setState('error')
    } finally {
      busy.current = false
    }
  }, [query])

  // New changes (here or synced from elsewhere) refresh the top of the list.
  const changed = ws
  useEffect(() => {
    if (!changed) return
    const timer = setTimeout(async () => {
      if (busy.current || loaded.current.items.length === 0) return
      try {
        const fresh = await fetchActivity(query())
        const merged = mergeFresh(fresh, loaded.current.items, loaded.current.next)
        setItems(merged.items)
        setNext(merged.nextBefore)
      } catch {
        // keep what is shown
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [changed, query])

  // Load more when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el || next === null) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [next, loadMore])

  const member = (id: string) => (id === me ? (byId(id) ?? owner) : byId(id))
  const memberName = (id: string) => (id === me ? t('activity.you') : byId(id)?.name)
  const filtered = Boolean(filter.kinds || filter.actor || filter.period !== 'all')

  if (state === 'error' && items.length === 0) {
    return (
      <div className="empty">
        <p>{t('activity.error')}</p>
        <button type="button" className="chip small" onClick={() => setAttempt((n) => n + 1)}>
          {t('activity.retry')}
        </button>
      </div>
    )
  }
  if (state === 'loading') return <p className="empty">{t('activity.loading')}</p>
  if (items.length === 0 && next === null) {
    return <p className="empty">{t(filtered ? 'activity.emptyFiltered' : 'activity.empty')}</p>
  }

  return (
    <>
      {groupByDay(items).map((g) => (
        <div key={g.date} className="group">
          <h2 className="group-title">{describeDate(g.date, ws.today)}</h2>
          <ul className="activity-lines">
            {g.items.map((item) => {
              const m = member(item.actor)
              const name = actorName(item.actor, me, m)
              return (
                <li key={`${item.seq}:${item.entityId}`} className="activity-line">
                  <MemberAvatar
                    member={m}
                    fallbackId={item.actor === SYSTEM_ACTOR ? name : item.actor}
                    size={24}
                  />
                  <div className="activity-body">
                    <EntityTitle item={item} />
                    <span className="activity-meta">
                      {describeLine(item, name, { ws, memberName })}
                      {item.container && (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="activity-container"
                            onClick={() =>
                              navigate(
                                item.container?.type === 'project'
                                  ? projectPath(item.container.id)
                                  : areaPath(item.container?.id ?? ''),
                              )
                            }
                          >
                            {item.container.title || t('activity.untitled')}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                  <time className="activity-time" dateTime={item.at}>
                    {formatDate(new Date(item.at), { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {next !== null ? (
        <div ref={sentinel} className="activity-more muted">
          {t('activity.loading')}
        </div>
      ) : (
        <p className="activity-more muted">{t('activity.end')}</p>
      )}
    </>
  )
}

/** The title of the entity; it opens the task, project or area when that still exists. */
function EntityTitle({ item }: { item: ActivityItem }) {
  const t = useT()
  const ws = useWorkspace()
  const title = item.title || t('activity.untitled')
  let open: (() => void) | null = null
  if (item.entityType === 'task') {
    const task = ws.tasks.find((x) => x.id === item.entityId)
    if (task) {
      open = () => {
        navigate(taskPath(pathOf(task, ws), task.id))
      }
    }
  } else if (item.entityType === 'project' && ws.projectById.has(item.entityId)) {
    open = () => navigate(projectPath(item.entityId))
  } else if (item.entityType === 'area' && ws.areaById.has(item.entityId)) {
    open = () => navigate(areaPath(item.entityId))
  } else if (item.entityType === 'heading' && item.container) {
    const projectId = item.container.id
    if (ws.projectById.has(projectId)) open = () => navigate(projectPath(projectId))
  }
  if (!open) return <span className="activity-title gone">{title}</span>
  return (
    <button type="button" className="activity-title" onClick={open}>
      {title}
    </button>
  )
}
