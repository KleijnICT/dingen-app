import { toCalendarDate } from '@dingen/core'
import { useEffect, useState } from 'react'
import { Account } from './Account.js'
import type { User } from './api.js'
import { AreaPage } from './components/AreaPage.js'
import { ListPage } from './components/ListPage.js'
import { ProjectPage } from './components/ProjectPage.js'
import { Sidebar } from './components/Sidebar.js'
import { LISTS } from './lists.js'
import { navigate, parseRoute, usePath } from './router.js'
import { useBuildWorkspace, useEngine, WorkspaceContext } from './store/context.js'

interface Props {
  user: User
  onSignedOut: () => void
}

/** The window after signing in: sidebar plus the chosen list, project or area. */
export function Shell({ user, onSignedOut }: Props) {
  const engine = useEngine()
  const path = usePath()
  const [today, setToday] = useState(toCalendarDate())
  const [focusSignal, setFocusSignal] = useState(0)
  const ws = useBuildWorkspace(today)
  const route = parseRoute(path)

  // The day changes at midnight; checking once a minute is enough.
  useEffect(() => {
    const timer = setInterval(() => setToday(toCalendarDate()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const list = route.kind === 'list' ? LISTS.find((l) => l.path === route.path) : undefined
  const project = route.kind === 'project' ? ws.projectById.get(route.id) : undefined
  const area = route.kind === 'area' ? ws.areaById.get(route.id) : undefined
  const missing =
    (route.kind === 'list' && !list) ||
    (route.kind === 'project' && !project) ||
    (route.kind === 'area' && !area)

  useEffect(() => {
    if (missing) navigate('/today')
  }, [missing])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      if (e.key === 'n' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setFocusSignal((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let page: React.ReactNode = null
  if (list) page = <ListPage key={list.id} list={list} focusSignal={focusSignal} />
  else if (project) {
    page = <ProjectPage key={project.id} project={project} focusSignal={focusSignal} />
  } else if (area) page = <AreaPage key={area.id} area={area} focusSignal={focusSignal} />
  else if (route.kind === 'account') page = <Account user={user} onSignedOut={onSignedOut} />

  return (
    <WorkspaceContext.Provider value={ws}>
      <div className="app">
        <Sidebar path={path} status={engine.status} email={user.email} />
        <main className="content">{page}</main>
      </div>
    </WorkspaceContext.Provider>
  )
}
