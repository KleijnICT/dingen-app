import {
  AREA_COLORS,
  AREA_ICONS,
  type Area,
  addDays,
  type ChecklistItem,
  commitTask,
  deleteTask,
  type Heading,
  mirrorChecklist,
  moveFields,
  newArea,
  newChecklistItem,
  newHeading,
  newProject,
  newTag,
  newTask,
  orderBetween,
  type Project,
  Repeat,
  type Snapshot,
  setRepeat,
  stopRepeat,
  type Tag,
  type Task,
  toggleProject,
  toggleTask,
  views,
  type When,
} from '@dingen/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { DingenClient } from './client.js'

/**
 * The MCP tools. Every tool refreshes the replica, works on a snapshot with
 * the same functions as the web app, and pushes the changes before it answers.
 */

const WhenInput = z
  .string()
  .describe("'inbox', 'anytime', 'someday', 'today', 'tomorrow' or a date YYYY-MM-DD")
const DateInput = z.string().describe("A date YYYY-MM-DD, or 'today' / 'tomorrow'")
const Ref = z.string().describe('Id or exact title (case-insensitive)')
const ListName = z.enum(['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook'])

const RepeatInput = z
  .object({
    unit: z.enum(['day', 'week', 'month', 'year']),
    every: z.number().int().min(1).default(1),
    basis: z.enum(['schedule', 'completion']).default('schedule'),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .default([])
      .describe('For weekly on a schedule: 0 = Sunday … 6 = Saturday'),
    start: DateInput.optional().describe('First occurrence; default today'),
    until: DateInput.nullable().default(null),
    deadlineDays: z.number().int().min(0).nullable().default(null),
  })
  .describe('A repeat rule; null removes the repetition')

const ChecklistInput = z
  .array(
    z.object({
      id: z.string().optional().describe('Keep an existing item; omit to add a new one'),
      title: z.string(),
      done: z.boolean().default(false),
    }),
  )
  .describe('The whole checklist in order; items not listed are removed')

class ToolError extends Error {}

export function createMcpServer(client: DingenClient): McpServer {
  const server = new McpServer({ name: 'dingen', version: '0.1.0' })

  const run = async <T>(fn: (ws: Snapshot) => T | Promise<T>) => {
    try {
      await client.refresh()
      const result = await fn(client.snapshot())
      await client.flush()
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 1) }] }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
    }
  }

  server.registerTool(
    'overview',
    {
      title: 'Overview of the structure',
      description:
        'Areas, projects (with headings), tags and the number of tasks per list. Call this first in a session; use the ids it returns.',
      inputSchema: {},
    },
    () =>
      run((ws) => ({
        today: ws.today,
        counts: {
          inbox: views.inbox(available(ws)).length,
          today: views.today(available(ws), ws.today).length,
          upcoming: views.upcoming(available(ws), ws.today).length,
          anytime: views.anytime(views.notInSomedayProject(available(ws), ws.projects), ws.today)
            .length,
          someday: views.someday(available(ws)).length,
        },
        areas: views.openAreas(ws.areas).map((a) => ({
          id: a.id,
          title: a.title,
          icon: a.icon,
          color: a.color,
          projects: views.projectsOf(ws.projects, a.id).map((p) => projectRow(ws, p)),
          looseTasks: views.areaTasks(ws.tasks, a.id).filter(views.isOpen).length,
        })),
        looseProjects: views.projectsOf(ws.projects, null).map((p) => projectRow(ws, p)),
        tags: ws.tags
          .filter((t) => !t.deleted)
          .sort(views.byOrder)
          .map((t) => ({
            id: t.id,
            title: t.title,
            parent: t.parentId ? (ws.tags.find((p) => p.id === t.parentId)?.title ?? null) : null,
          })),
      })),
  )

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'Open tasks of a list (inbox, today, upcoming, anytime, someday, logbook), a project, an area or a tag. Combine filters to narrow down.',
      inputSchema: {
        list: ListName.optional(),
        project: Ref.optional(),
        area: Ref.optional(),
        tag: Ref.optional(),
        includeCompleted: z.boolean().default(false),
      },
    },
    (input) =>
      run((ws) => {
        let tasks: Task[]
        if (input.list) tasks = listTasks(ws, input.list)
        else tasks = available(ws).filter((t) => input.includeCompleted || views.isOpen(t))
        if (input.list && input.includeCompleted && input.list !== 'logbook') {
          tasks = [...tasks, ...ws.tasks.filter((t) => views.isLogbook(t))]
        }
        if (input.project) {
          const p = findProject(ws, input.project)
          tasks = tasks.filter((t) => t.projectId === p.id)
        }
        if (input.area) {
          const a = findArea(ws, input.area)
          const projectIds = new Set(views.projectsOf(ws.projects, a.id).map((p) => p.id))
          tasks = tasks.filter(
            (t) => t.areaId === a.id || (t.projectId !== null && projectIds.has(t.projectId)),
          )
        }
        if (input.tag) {
          const tag = findTag(ws, input.tag)
          tasks = tasks.filter((t) => t.tagIds.includes(tag.id))
        }
        if (!input.list) tasks = tasks.sort(views.byOrder)
        return tasks.map((t) => taskRow(ws, t))
      }),
  )

  server.registerTool(
    'get_task',
    {
      title: 'Get a task',
      description: 'Everything about one task: notes, checklist, repeat rule, dates.',
      inputSchema: { id: z.string() },
    },
    ({ id }) => run((ws) => taskDetail(ws, findTask(ws, id))),
  )

  server.registerTool(
    'search',
    {
      title: 'Search',
      description: 'Finds open tasks and projects whose title or notes contain the text.',
      inputSchema: { query: z.string().min(1), includeCompleted: z.boolean().default(false) },
    },
    ({ query, includeCompleted }) =>
      run((ws) => {
        const q = query.toLowerCase()
        const hit = (title: string, notes: string) =>
          title.toLowerCase().includes(q) || notes.toLowerCase().includes(q)
        return {
          tasks: ws.tasks
            .filter((t) => t.repeat === null && (includeCompleted || views.isOpen(t)))
            .filter((t) => hit(t.title, t.notes))
            .map((t) => taskRow(ws, t)),
          projects: ws.projects
            .filter((p) => includeCompleted || views.isOpen(p))
            .filter((p) => hit(p.title, p.notes))
            .map((p) => projectRow(ws, p)),
        }
      }),
  )

  server.registerTool(
    'create_task',
    {
      title: 'Create a task',
      description:
        'Creates a task. Without `when` and without a project or area it lands in the Inbox, which is where capture belongs. Tags must exist unless createTags is true.',
      inputSchema: {
        title: z.string().min(1),
        notes: z.string().default(''),
        when: WhenInput.optional(),
        evening: z.boolean().default(false),
        deadline: DateInput.nullable().default(null),
        project: Ref.optional(),
        heading: Ref.optional().describe('Heading within the project'),
        area: Ref.optional(),
        tags: z.array(Ref).default([]),
        createTags: z.boolean().default(false),
        checklist: z.array(z.string()).default([]),
        repeat: RepeatInput.optional(),
      },
    },
    (input) =>
      run((ws) => {
        if (input.project && input.area)
          throw new ToolError('A task has a project or an area, not both')
        const project = input.project ? findProject(ws, input.project) : null
        const area = input.area ? findArea(ws, input.area) : null
        const heading = project && input.heading ? findHeading(ws, project, input.heading) : null
        const inContainer = project !== null || area !== null
        const when = input.when
          ? parseWhen(input.when, ws.today)
          : inContainer
            ? { kind: 'anytime' as const }
            : { kind: 'inbox' as const }
        if (when.kind === 'inbox' && inContainer)
          throw new ToolError('A task in a project or area cannot be in the Inbox')
        const tagIds = resolveTags(client, ws, input.tags, input.createTags)
        const siblings = project
          ? views
              .projectTasks(ws.tasks, project.id)
              .filter((t) => t.headingId === (heading?.id ?? null))
          : area
            ? views.areaTasks(ws.tasks, area.id)
            : views.inbox(ws.tasks)
        const task = newTask({
          title: input.title,
          notes: input.notes,
          when,
          evening: input.evening && when.kind === 'date',
          deadline: input.deadline ? parseDate(input.deadline, ws.today) : null,
          projectId: project?.id ?? null,
          headingId: heading?.id ?? null,
          areaId: area?.id ?? null,
          tagIds,
          order: orderBetween(siblings.at(-1)?.order ?? null, null),
        })
        client.create('task', task)
        let order: string | null = null
        for (const title of input.checklist) {
          order = orderBetween(order, null)
          client.create('checklistItem', newChecklistItem({ title, taskId: task.id, order }))
        }
        if (input.repeat) {
          const after = client.snapshot()
          const created = after.tasks.find((t) => t.id === task.id)
          if (created) setRepeat(client, after, created, parseRepeat(input.repeat, ws.today))
        }
        return taskDetail(client.snapshot(), findTask(client.snapshot(), task.id))
      }),
  )

  server.registerTool(
    'update_task',
    {
      title: 'Update a task',
      description:
        'Changes fields of a task. Omitted fields stay as they are. `project`, `area` or `heading` move the task; `tags` replaces all tags; `checklist` replaces the checklist; `repeat: null` stops repeating.',
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).optional(),
        notes: z.string().optional(),
        when: WhenInput.optional(),
        evening: z.boolean().optional(),
        deadline: DateInput.nullable().optional(),
        project: Ref.nullable().optional().describe('null removes the task from its project'),
        heading: Ref.nullable().optional(),
        area: Ref.nullable().optional(),
        tags: z.array(Ref).optional(),
        createTags: z.boolean().default(false),
        checklist: ChecklistInput.optional(),
        repeat: RepeatInput.nullable().optional(),
      },
    },
    (input) =>
      run((ws) => {
        const task = findTask(ws, input.id)
        const fields: Record<string, unknown> = {}
        if (input.title !== undefined) fields.title = input.title
        if (input.notes !== undefined) fields.notes = input.notes
        if (input.when !== undefined) {
          const when = parseWhen(input.when, ws.today)
          fields.when = when
          fields.evening = when.kind === 'date' ? (input.evening ?? task.evening) : false
        } else if (input.evening !== undefined) {
          fields.evening = input.evening && task.when.kind === 'date'
        }
        if (input.deadline !== undefined) {
          fields.deadline = input.deadline === null ? null : parseDate(input.deadline, ws.today)
        }
        if (input.tags !== undefined) {
          fields.tagIds = resolveTags(client, ws, input.tags, input.createTags)
        }
        if (
          input.project !== undefined ||
          input.area !== undefined ||
          input.heading !== undefined
        ) {
          Object.assign(fields, moveFieldsFor(ws, task, input))
        }
        commitTask(client, ws, task, fields)
        if (input.checklist !== undefined) replaceChecklist(client, ws, task, input.checklist)
        if (input.repeat !== undefined) {
          const fresh = client.snapshot()
          const current = findTask(fresh, task.id)
          if (input.repeat === null) stopRepeat(client, fresh, current)
          else setRepeat(client, fresh, current, parseRepeat(input.repeat, ws.today))
        }
        return taskDetail(client.snapshot(), findTask(client.snapshot(), task.id))
      }),
  )

  server.registerTool(
    'complete_task',
    {
      title: 'Complete a task',
      description: 'Marks a task as done. A repeating task gets its next occurrence.',
      inputSchema: { id: z.string() },
    },
    ({ id }) =>
      run((ws) => {
        const task = findTask(ws, id)
        if (task.status !== 'open') throw new ToolError('Task is not open')
        toggleTask(client, ws, task)
        return { completed: task.id }
      }),
  )

  server.registerTool(
    'reopen_task',
    {
      title: 'Reopen a task',
      description: 'Puts a completed or canceled task back among the open ones.',
      inputSchema: { id: z.string() },
    },
    ({ id }) =>
      run((ws) => {
        const task = findTask(ws, id)
        if (task.status === 'open') throw new ToolError('Task is already open')
        toggleTask(client, ws, task)
        return { reopened: task.id }
      }),
  )

  server.registerTool(
    'cancel_task',
    {
      title: 'Cancel a task',
      description: 'Closes a task without doing it; it goes to the Logbook as canceled.',
      inputSchema: { id: z.string() },
    },
    ({ id }) =>
      run((ws) => {
        const task = findTask(ws, id)
        client.mutate('task', task.id, {
          status: 'canceled',
          completedAt: new Date().toISOString(),
        })
        return { canceled: task.id }
      }),
  )

  server.registerTool(
    'delete_task',
    {
      title: 'Delete a task',
      description: 'Deletes a task. For a repeating task this skips the occurrence.',
      inputSchema: { id: z.string() },
    },
    ({ id }) =>
      run((ws) => {
        const task = findTask(ws, id)
        deleteTask(client, ws, task)
        return { deleted: task.id }
      }),
  )

  server.registerTool(
    'create_project',
    {
      title: 'Create a project',
      description: 'Creates a project, optionally in an area and with a plan date or deadline.',
      inputSchema: {
        title: z.string().min(1),
        notes: z.string().default(''),
        area: Ref.optional(),
        when: WhenInput.optional().describe(
          "'anytime' (default), 'someday', 'today', 'tomorrow' or a date",
        ),
        deadline: DateInput.nullable().default(null),
        tags: z.array(Ref).default([]),
        createTags: z.boolean().default(false),
        headings: z.array(z.string()).default([]),
      },
    },
    (input) =>
      run((ws) => {
        const area = input.area ? findArea(ws, input.area) : null
        const when = input.when ? parseWhen(input.when, ws.today) : { kind: 'anytime' as const }
        if (when.kind === 'inbox') throw new ToolError('A project cannot be in the Inbox')
        const siblings = views.projectsOf(ws.projects, area?.id ?? null)
        const project = newProject({
          title: input.title,
          notes: input.notes,
          areaId: area?.id ?? null,
          when,
          deadline: input.deadline ? parseDate(input.deadline, ws.today) : null,
          tagIds: resolveTags(client, ws, input.tags, input.createTags),
          order: orderBetween(siblings.at(-1)?.order ?? null, null),
        })
        client.create('project', project)
        let order: string | null = null
        for (const title of input.headings) {
          order = orderBetween(order, null)
          client.create('heading', newHeading({ title, projectId: project.id, order }))
        }
        return projectRow(client.snapshot(), project)
      }),
  )

  server.registerTool(
    'update_project',
    {
      title: 'Update a project',
      description: 'Changes title, notes, area, plan date, deadline or tags of a project.',
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).optional(),
        notes: z.string().optional(),
        area: Ref.nullable().optional(),
        when: WhenInput.optional(),
        deadline: DateInput.nullable().optional(),
        tags: z.array(Ref).optional(),
        createTags: z.boolean().default(false),
      },
    },
    (input) =>
      run((ws) => {
        const project = findProject(ws, input.id)
        const fields: Record<string, unknown> = {}
        if (input.title !== undefined) fields.title = input.title
        if (input.notes !== undefined) fields.notes = input.notes
        if (input.area !== undefined)
          fields.areaId = input.area === null ? null : findArea(ws, input.area).id
        if (input.when !== undefined) {
          const when = parseWhen(input.when, ws.today)
          if (when.kind === 'inbox') throw new ToolError('A project cannot be in the Inbox')
          fields.when = when
        }
        if (input.deadline !== undefined) {
          fields.deadline = input.deadline === null ? null : parseDate(input.deadline, ws.today)
        }
        if (input.tags !== undefined)
          fields.tagIds = resolveTags(client, ws, input.tags, input.createTags)
        if (Object.keys(fields).length > 0) client.mutate('project', project.id, fields)
        return projectRow(client.snapshot(), { ...project, ...fields } as Project)
      }),
  )

  server.registerTool(
    'complete_project',
    {
      title: 'Complete or reopen a project',
      description:
        'Marks a project as done (its open tasks disappear from the lists), or reopens it.',
      inputSchema: { id: z.string(), reopen: z.boolean().default(false) },
    },
    ({ id, reopen }) =>
      run((ws) => {
        const project = findProject(ws, id)
        if ((project.status === 'open') === reopen) {
          throw new ToolError(reopen ? 'Project is already open' : 'Project is already closed')
        }
        toggleProject(client, project)
        return { project: project.id, status: reopen ? 'open' : 'completed' }
      }),
  )

  server.registerTool(
    'create_area',
    {
      title: 'Create an area',
      description: 'Creates an area of responsibility, optionally with an icon and a colour.',
      inputSchema: {
        title: z.string().min(1),
        icon: z.enum(AREA_ICONS).optional(),
        color: z.enum(AREA_COLORS).optional(),
      },
    },
    ({ title, icon, color }) =>
      run((ws) => {
        const last = views.openAreas(ws.areas).at(-1)
        const area = newArea({
          title,
          order: orderBetween(last?.order ?? null, null),
          icon: icon ?? null,
          color: color === 'gray' ? null : (color ?? null),
        })
        client.create('area', area)
        return { id: area.id, title: area.title, icon: area.icon, color: area.color }
      }),
  )

  server.registerTool(
    'create_heading',
    {
      title: 'Create a heading',
      description: 'Adds a heading at the end of a project.',
      inputSchema: { project: Ref, title: z.string().min(1) },
    },
    (input) =>
      run((ws) => {
        const project = findProject(ws, input.project)
        const last = views.headingsOf(ws.headings, project.id).at(-1)
        const heading = newHeading({
          title: input.title,
          projectId: project.id,
          order: orderBetween(last?.order ?? null, null),
        })
        client.create('heading', heading)
        return { id: heading.id, title: heading.title, project: project.id }
      }),
  )

  server.registerTool(
    'create_tag',
    {
      title: 'Create a tag',
      description:
        'Creates a tag, optionally under a parent tag. Only when the user asked for a new tag.',
      inputSchema: { title: z.string().min(1), parent: Ref.optional() },
    },
    (input) =>
      run((ws) => {
        const parent = input.parent ? findTag(ws, input.parent) : null
        const tag = createTag(client, ws, input.title, parent?.id ?? null)
        return { id: tag.id, title: tag.title, parent: parent?.title ?? null }
      }),
  )

  return server
}

// ---------- lookups

function available(ws: Snapshot): Task[] {
  return views.available(ws.tasks, ws.projects)
}

function listTasks(ws: Snapshot, list: z.infer<typeof ListName>): Task[] {
  const avail = available(ws)
  switch (list) {
    case 'inbox':
      return views.inbox(avail)
    case 'today':
      return views.today(avail, ws.today)
    case 'upcoming':
      return views.upcoming(avail, ws.today)
    case 'anytime':
      return views.anytime(views.notInSomedayProject(avail, ws.projects), ws.today)
    case 'someday':
      return views.someday(avail)
    case 'logbook':
      return views.logbook(ws.tasks)
  }
}

function byRef<T extends { id: string; title: string }>(items: T[], ref: string, what: string): T {
  const byId = items.find((i) => i.id === ref)
  if (byId) return byId
  const needle = ref.trim().toLowerCase()
  const matches = items.filter((i) => i.title.trim().toLowerCase() === needle)
  if (matches.length === 1) return matches[0] as T
  if (matches.length > 1)
    throw new ToolError(`More than one ${what} is called "${ref}"; use the id`)
  throw new ToolError(`No ${what} "${ref}"`)
}

function findTask(ws: Snapshot, id: string): Task {
  const task = ws.tasks.find((t) => t.id === id && t.repeat === null)
  if (!task) throw new ToolError(`No task with id ${id}`)
  return task
}

function findProject(ws: Snapshot, ref: string): Project {
  return byRef(ws.projects.filter(views.isOpen), ref, 'project')
}

function findArea(ws: Snapshot, ref: string): Area {
  return byRef(views.openAreas(ws.areas), ref, 'area')
}

function findTag(ws: Snapshot, ref: string): Tag {
  return byRef(
    ws.tags.filter((t) => !t.deleted),
    ref,
    'tag',
  )
}

function findHeading(ws: Snapshot, project: Project, ref: string): Heading {
  return byRef(views.headingsOf(ws.headings, project.id), ref, 'heading')
}

function resolveTags(
  client: DingenClient,
  ws: Snapshot,
  refs: string[],
  create: boolean,
): string[] {
  const ids: string[] = []
  for (const ref of refs) {
    try {
      ids.push(findTag(ws, ref).id)
    } catch (err) {
      if (!create)
        throw new ToolError(`${(err as Error).message}. Pass createTags: true to create it.`)
      ids.push(createTag(client, ws, ref, null).id)
    }
  }
  return [...new Set(ids)]
}

function createTag(
  client: DingenClient,
  ws: Snapshot,
  title: string,
  parentId: string | null,
): Tag {
  const last = [...ws.tags].sort(views.byOrder).at(-1)
  const tag = newTag({
    title: title.trim(),
    parentId,
    order: orderBetween(last?.order ?? null, null),
  })
  client.create('tag', tag)
  ws.tags.push(tag)
  return tag
}

function moveFieldsFor(
  ws: Snapshot,
  task: Task,
  input: {
    project?: string | null | undefined
    area?: string | null | undefined
    heading?: string | null | undefined
  },
): Record<string, unknown> {
  if (input.area) {
    return moveFields(ws, task, { kind: 'area', areaId: findArea(ws, input.area).id })
  }
  if (input.project) {
    const project = findProject(ws, input.project)
    const heading = input.heading ? findHeading(ws, project, input.heading) : null
    return moveFields(ws, task, {
      kind: 'project',
      projectId: project.id,
      headingId: heading?.id ?? null,
    })
  }
  if (input.project === null || input.area === null) return moveFields(ws, task, { kind: 'none' })
  if (input.heading !== undefined) {
    if (!task.projectId)
      throw new ToolError('Task is not in a project, so it cannot have a heading')
    const project = findProject(ws, task.projectId)
    const heading = input.heading ? findHeading(ws, project, input.heading) : null
    return moveFields(ws, task, {
      kind: 'project',
      projectId: project.id,
      headingId: heading?.id ?? null,
    })
  }
  return {}
}

function replaceChecklist(
  client: DingenClient,
  ws: Snapshot,
  task: Task,
  items: z.infer<typeof ChecklistInput>,
): void {
  const existing = ws.checklistByTask.get(task.id) ?? []
  const keep = new Set(items.map((i) => i.id).filter((id): id is string => Boolean(id)))
  for (const old of existing) {
    if (!keep.has(old.id)) client.mutate('checklistItem', old.id, { deleted: true })
  }
  let order: string | null = null
  const next: ChecklistItem[] = []
  for (const item of items) {
    order = orderBetween(order, null)
    const current = item.id ? existing.find((e) => e.id === item.id) : undefined
    if (current) {
      const fields: Record<string, unknown> = {}
      if (current.title !== item.title) fields.title = item.title
      if (current.done !== item.done) fields.done = item.done
      if (current.order !== order) fields.order = order
      if (Object.keys(fields).length > 0) client.mutate('checklistItem', current.id, fields)
      next.push({ ...current, title: item.title, done: item.done, order })
    } else {
      const created = newChecklistItem({
        title: item.title,
        done: item.done,
        taskId: task.id,
        order,
      })
      client.create('checklistItem', created)
      next.push(created)
    }
  }
  mirrorChecklist(client, ws, task, next)
}

// ---------- parsing

function parseDate(input: string, today: string): string {
  if (input === 'today') return today
  if (input === 'tomorrow') return addDays(today, 1)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new ToolError(`Not a date: "${input}"`)
  return input
}

function parseWhen(input: string, today: string): When {
  switch (input) {
    case 'inbox':
    case 'anytime':
    case 'someday':
      return { kind: input }
    default:
      return { kind: 'date', date: parseDate(input, today) }
  }
}

function parseRepeat(input: z.infer<typeof RepeatInput>, today: string): Repeat {
  return Repeat.parse({
    unit: input.unit,
    every: input.every,
    basis: input.basis,
    weekdays: input.weekdays,
    start: input.start ? parseDate(input.start, today) : today,
    until: input.until ? parseDate(input.until, today) : null,
    deadlineDays: input.deadlineDays,
  })
}

// ---------- output

function describeWhen(when: When): string {
  return when.kind === 'date' ? when.date : when.kind
}

function taskRow(ws: Snapshot, t: Task) {
  const project = t.projectId ? ws.projects.find((p) => p.id === t.projectId) : null
  const area = t.areaId ? ws.areas.find((a) => a.id === t.areaId) : null
  const heading = t.headingId ? ws.headings.find((h) => h.id === t.headingId) : null
  const checklist = views.checklistProgress(ws.checklistByTask.get(t.id) ?? [])
  const template = t.templateId ? ws.templateById.get(t.templateId) : undefined
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    when: describeWhen(t.when),
    ...(t.evening ? { evening: true } : {}),
    ...(t.deadline ? { deadline: t.deadline } : {}),
    ...(project ? { project: project.title } : {}),
    ...(heading ? { heading: heading.title } : {}),
    ...(area ? { area: area.title } : {}),
    ...(t.tagIds.length > 0 ? { tags: tagTitles(ws, t.tagIds) } : {}),
    ...(t.notes ? { notes: t.notes.length > 120 ? `${t.notes.slice(0, 120)}…` : t.notes } : {}),
    ...(checklist.total > 0 ? { checklist: `${checklist.done}/${checklist.total}` } : {}),
    ...(template?.repeat ? { repeats: describeRepeat(template.repeat) } : {}),
    ...(t.completedAt ? { completedAt: t.completedAt } : {}),
  }
}

function taskDetail(ws: Snapshot, t: Task) {
  const template = t.templateId ? ws.templateById.get(t.templateId) : undefined
  return {
    ...taskRow(ws, t),
    notes: t.notes,
    projectId: t.projectId,
    headingId: t.headingId,
    areaId: t.areaId,
    tagIds: t.tagIds,
    checklistItems: (ws.checklistByTask.get(t.id) ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      done: i.done,
    })),
    repeat: template?.repeat ?? null,
    createdAt: t.createdAt,
  }
}

function projectRow(ws: Snapshot, p: Project) {
  const area = p.areaId ? ws.areas.find((a) => a.id === p.areaId) : null
  const open = ws.tasks.filter((t) => t.projectId === p.id && views.isOpen(t)).length
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    when: describeWhen(p.when),
    ...(p.deadline ? { deadline: p.deadline } : {}),
    ...(area ? { area: area.title } : {}),
    ...(p.tagIds.length > 0 ? { tags: tagTitles(ws, p.tagIds) } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
    openTasks: open,
    headings: views.headingsOf(ws.headings, p.id).map((h) => ({ id: h.id, title: h.title })),
  }
}

function tagTitles(ws: Snapshot, ids: string[]): string[] {
  return ids.map((id) => ws.tags.find((t) => t.id === id)?.title ?? id)
}

function describeRepeat(rule: Repeat): string {
  const unit = rule.every === 1 ? rule.unit : `${rule.every} ${rule.unit}s`
  const days =
    rule.unit === 'week' && rule.weekdays.length > 0
      ? ` on ${rule.weekdays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`
      : ''
  const basis = rule.basis === 'completion' ? ' after completion' : ''
  const until = rule.until ? ` until ${rule.until}` : ''
  return `every ${unit}${days}${basis}${until}`
}
