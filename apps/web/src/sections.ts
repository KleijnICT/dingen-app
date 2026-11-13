import type { Heading, Task } from '@dingen/core'
import { views } from '@dingen/core'

/**
 * How a project page is laid out: open tasks without a heading, open tasks
 * per heading, and every completed task in one section of its own below all
 * headings. A completed task never shows up inside a heading group, so it
 * cannot look as if it belongs to the last heading.
 */
export interface ProjectSections {
  loose: Task[]
  headings: { heading: Heading; tasks: Task[] }[]
  completed: Task[]
}

/**
 * `shown` is what stays in place: the open tasks plus any task just ticked
 * off that lingers for a moment (see useLinger). `all` is every task of the
 * project; the completed ones that are not lingering go to the section,
 * most recently completed first. `keep` (a tag filter) narrows the open
 * groups only. A task whose heading is gone counts as having no heading.
 */
export function projectSections(
  all: Task[],
  shown: Task[],
  headings: Heading[],
  keep: (task: Task) => boolean = () => true,
): ProjectSections {
  const known = new Set(headings.map((h) => h.id))
  const open = shown.filter(keep)
  return {
    loose: open.filter((task) => task.headingId === null || !known.has(task.headingId)),
    headings: headings.map((heading) => ({
      heading,
      tasks: open.filter((task) => task.headingId === heading.id),
    })),
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
