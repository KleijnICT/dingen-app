import { toCalendarDate } from '@dingen/core'
import { useEffect, useState } from 'react'
import { Account } from './Account.js'
import type { User } from './api.js'
import { ListPage } from './components/ListPage.js'
import { Sidebar } from './components/Sidebar.js'
import { LISTS } from './lists.js'
import { navigate, usePath } from './router.js'
import { useEngine, useTasks } from './store/context.js'

interface Props {
  user: User
  onSignedOut: () => void
}

/** Het venster na inloggen: zijbalk plus de gekozen lijst. */
export function Shell({ user, onSignedOut }: Props) {
  const engine = useEngine()
  const tasks = useTasks()
  const path = usePath()
  const [today, setToday] = useState(toCalendarDate())
  const [focusSignal, setFocusSignal] = useState(0)

  // Dag wisselt om middernacht; eens per minuut kijken is genoeg.
  useEffect(() => {
    const timer = setInterval(() => setToday(toCalendarDate()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (path === '/' || (!LISTS.some((l) => l.path === path) && path !== '/account')) {
      navigate('/vandaag')
    }
  }, [path])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if (e.key === 'n' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setFocusSignal((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const list = LISTS.find((l) => l.path === path)

  return (
    <div className="app">
      <Sidebar path={path} tasks={tasks} today={today} status={engine.status} email={user.email} />
      <main className="content">
        {list ? (
          <ListPage key={list.id} list={list} today={today} focusSignal={focusSignal} />
        ) : (
          <Account user={user} onSignedOut={onSignedOut} />
        )}
      </main>
    </div>
  )
}
