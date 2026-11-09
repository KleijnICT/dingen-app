import type { Area, ChecklistItem, Heading, Project, Snapshot, Tag, Task } from '@dingen/core'
import { buildSnapshot } from '@dingen/core'
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { SyncEngine } from './engine.js'

export const EngineContext = createContext<SyncEngine | null>(null)

export function useEngine(): SyncEngine {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('No SyncEngine in context')
  return engine
}

/** Re-renders on every change in the replica. */
export function useEngineVersion(): number {
  const engine = useEngine()
  return useSyncExternalStore(engine.subscribe, engine.getVersion)
}

export function useTasks(): Task[] {
  const engine = useEngine()
  useEngineVersion()
  return engine.entities('task') as Task[]
}

/**
 * Everything a page needs, read once per replica version: the live entities
 * (deleted ones are already filtered out by the engine), lookup maps and the
 * current day. Provided by the Shell.
 */
export interface Workspace extends Snapshot {
  projectById: Map<string, Project>
  areaById: Map<string, Area>
  headingById: Map<string, Heading>
  tagById: Map<string, Tag>
}

export const WorkspaceContext = createContext<Workspace | null>(null)

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext)
  if (!ws) throw new Error('No Workspace in context')
  return ws
}

export function useBuildWorkspace(today: string): Workspace {
  const engine = useEngine()
  const version = useEngineVersion()
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the engine's change counter
  return useMemo(() => {
    const tasks = engine.entities('task') as Task[]
    const projects = engine.entities('project') as Project[]
    const areas = engine.entities('area') as Area[]
    const headings = engine.entities('heading') as Heading[]
    const tags = engine.entities('tag') as Tag[]
    const checklist = engine.entities('checklistItem') as ChecklistItem[]
    return {
      ...buildSnapshot(today, { tasks, projects, areas, headings, tags, checklist }),
      projectById: new Map(projects.map((p) => [p.id, p])),
      areaById: new Map(areas.map((a) => [a.id, a])),
      headingById: new Map(headings.map((h) => [h.id, h])),
      tagById: new Map(tags.map((t) => [t.id, t])),
    }
  }, [engine, version, today])
}
