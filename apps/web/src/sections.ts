import type { Heading, Project, Task } from '@dingen/core'
import { views } from '@dingen/core'

/**
 * How a project page is laid out: open tasks without a heading, open tasks
 * per heading, the Someday tasks (whatever their heading) in a section of
 * their own below the headings, and every completed task in one section
 * below that. A completed task never shows up inside a heading group, so it
 * cannot look as if it belongs to the last heading.
 */
export interface ProjectSections {
  loose: Task[]
  headings: { heading: Heading; tasks: Task[] }[]
  someday: Task[]
  completed: Task[]
}

/**
 * Whether a row belongs in the Someday section of a project or area page.
 * Unlike views.isSomeday this also holds for a task that was just ticked
 * off and lingers in place, so it does not jump out of the section first.
 */
export function onSomeday(item: Task | Project): boolean {
  return !item.deleted && item.when.kind === 'someday'
}

/** Splits rows into the regular ones and the Someday ones, each in its own order. */
export function splitSomeday<T extends Task | Project>(items: T[]): { regular: T[]; someday: T[] } {
  const regular: T[] = []
  const someday: T[] = []
  for (const item of items) (onSomeday(item) ? someday : regular).push(item)
  return { regular, someday }
}

/**
 * `shown` is what stays in place: the open tasks plus any task just ticked
 * off that lingers for a moment (see useLinger). `all` is every task of the
 * project; the completed ones that are not lingering go to the section,
 * most recently completed first. `keep` (a tag filter) narrows the open
 * groups only. A task whose heading is gone counts as having no heading.
 * An open task on Someday leaves its place (also under a heading) for the
 * Someday section, in the order it already has.
 */
export function projectSections(
  all: Task[],
  shown: Task[],
  headings: Heading[],
  keep: (task: Task) => boolean = () => true,
): ProjectSections {
  const known = new Set(headings.map((h) => h.id))
  const { regular: open, someday } = splitSomeday(shown.filter(keep))
  return {
    loose: open.filter((task) => task.headingId === null || !known.has(task.headingId)),
    headings: headings.map((heading) => ({
      heading,
      tasks: open.filter((task) => task.headingId === heading.id),
    })),
    someday,
    completed: completedSection(all, shown),
  }
}

/** Completed tasks that are not lingering in place, most recent first. */
export function completedSection(all: Task[], shown: Task[]): Task[] {
  const inPlace = new Set(shown.map((task) => task.id))
  return all
    .filter((task) => task.status !== 'open' && !inPlace.has(task.id))
    .sort(views.byCompletedDesc)
}
