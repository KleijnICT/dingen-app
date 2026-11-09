import type { Task } from '@dingen/core'
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { SyncEngine } from './engine.js'

export const EngineContext = createContext<SyncEngine | null>(null)

export function useEngine(): SyncEngine {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('Geen SyncEngine in de context')
  return engine
}

/** Rendert opnieuw bij elke wijziging in de replica. */
export function useEngineVersion(): number {
  const engine = useEngine()
  return useSyncExternalStore(engine.subscribe, engine.getVersion)
}

export function useTasks(): Task[] {
  const engine = useEngine()
  useEngineVersion()
  return engine.entities('task') as Task[]
}
