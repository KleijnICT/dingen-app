# Design

Dingen's promise is _a beautifully calm home for the stuff you have to do_.
This file is how the web client keeps that promise as it grows: a small set of
tokens, one component per job, and a few rules. Everything here lives in
`apps/web/src/styles.css`; the token block is at the top of that file.

## Principles

1. **Calm.** Few colours on screen at once, quiet controls that show their
   shape on hover, one filled button per screen at most. When in doubt, leave
   it out.
2. **Tokens only.** Colours, spacing, type sizes, weights, radii, shadows and
   durations come from the token block. No raw colours and no raw spacing or
   type values in components or in CSS outside the token block. One-off
   element dimensions (a dot's diameter, a popover's width, a 1px hairline)
   may be literal.
3. **Light and dark, always both.** Every colour token has a dark value. A
   change is not done until it has been looked at in both.
4. **One component per job.** One icon button, one set of button variants,
   one section heading, one active style. If a new screen needs something
   that looks almost like an existing component, use the existing one.

## Tokens

The root font size is 15px, so `1rem` is 15px.

### Colour

| Token                                                                                 | Use                                                              |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `--bg`                                                                                | The window and content background                                |
| `--surface`                                                                           | Raised things: panels, popovers, cards, the active nav item      |
| `--sidebar`                                                                           | The sidebar and side columns                                     |
| `--fg`                                                                                | Text                                                             |
| `--muted`                                                                             | Secondary text and quiet icons                                   |
| `--line`                                                                              | Hairlines and control borders                                    |
| `--resize-line`                                                                       | The resize handle's line                                         |
| `--check`                                                                             | The empty task circle and checkboxes                             |
| `--hover`                                                                             | The one hover background                                         |
| `--scrim`                                                                             | Behind drawers, overlays and windows                             |
| `--accent`                                                                            | Links, focus rings, accent text and icons                        |
| `--accent-fill`                                                                       | Filled accent surfaces (primary button, chosen chip, done check) |
| `--on-accent`                                                                         | Text and icons on `--accent-fill` or `--error-fill`              |
| `--tint`                                                                              | Soft accent background: "you are here", "drop here"              |
| `--selected`                                                                          | Background of chosen tasks                                       |
| `--focus-ring`                                                                        | The keyboard focus outline                                       |
| `--red`, `--error`                                                                    | The one red: errors, late deadlines, destructive text            |
| `--error-fill`                                                                        | Filled destructive button                                        |
| `--ok`                                                                                | Success                                                          |
| `--inbox`, `--today`, `--upcoming`, `--someday`, `--logbook`, `--review`, `--evening` | The lists' own colours, for their icons                          |
| `--area-*`                                                                            | The nine colours a user can give an area                         |

### Space

One scale: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4`
16px, `--space-5` 24px, `--space-6` 32px, `--space-7` 48px, plus `--space-0`
2px for the hairline gap between rows.

Row geometry has its own three tokens, because everything in a list lines up
on them:

| Token          | Value | Use                                                       |
| -------------- | ----- | --------------------------------------------------------- |
| `--check-size` | 20px  | The task circle                                           |
| `--row-x`      | 10px  | A row's side inset, and the gap from its icon to its text |
| `--indent`     | 30px  | Everything "after the circle": notes, fields, pickers     |

### Type

| Token          | Size  | Use                                           |
| -------------- | ----- | --------------------------------------------- |
| `--text-xs`    | ~11px | Meta in rows: dates, tags, captions           |
| `--text-sm`    | ~13px | Secondary text, section headings, chips       |
| `--text-md`    | 15px  | Body                                          |
| `--text-lg`    | ~17px | Panel and editor titles                       |
| `--text-xl`    | 27px  | Page titles                                   |
| `--text-touch` | 16px  | Inputs on phones (smaller ones make iOS zoom) |

Weights: `--weight-regular` 400 (body), `--weight-medium` 500 (navigation,
chips, labels, quiet buttons), `--weight-strong` 600 (section headings,
primary buttons), `--weight-title` 700 (page titles). Fonts: `--font-ui` and
`--font-mono`.

### Shape and depth

| Token        | Value | Use                                     |
| ------------ | ----- | --------------------------------------- |
| `--r-sm`     | 6px   | Icon buttons, menu rows, small controls |
| `--r-md`     | 8px   | Rows, inputs, buttons, fieldsets        |
| `--r-lg`     | 12px  | Popovers, windows, cards                |
| `--r-pill`   | 999px | Chips, pills and circles                |
| `--shadow-1` |       | The active navigation item              |
| `--shadow-2` |       | Popovers, drawers, floating bars        |
| `--shadow-3` |       | Windows: settings, search               |

Shadows are heavier in dark, where a light shadow would disappear.

### Motion

`--dur-fast` (120ms) for hover fades and chevrons, `--dur` (200ms) for
panels, drawers and sheets; `--ease` for things coming in, `--ease-in` for
things going out. Every animation has a `prefers-reduced-motion` fallback.

### Controls and panes

| Token                                                   | Value           | Use                                       |
| ------------------------------------------------------- | --------------- | ----------------------------------------- |
| `--control`                                             | 28px            | Icon button                               |
| `--control-sm`                                          | 22px            | Small icon button, inside rows and fields |
| `--control-touch`                                       | 32px            | Icon button on touch screens              |
| `--pane-head`                                           | 48px            | The head of every pane (see "Panes")      |
| `--pane-pad-x`, `--pane-pad-y`                          | 16px, 12px      | A pane's inner margins                    |
| `--pane-inset`                                          | 6px             | A list of rows inside a pane              |
| `--rail`                                                | 56px            | The sidebar folded to icons               |
| `--rail-item`                                           | 36px            | One icon in the rail                      |
| `--sidebar-default`, `--panel-default`, `--content-max` | 220, 420, 640px | Default column widths                     |
| `--sheet-w`                                             | 280px           | The width of a sheet (see "Sheets")       |

## Components

### Buttons

The base `button` is neutral: no background, no border, inherited colour,
medium weight. A button that should look like a button asks for a variant:

| Class               | Looks                   | Use                                                    |
| ------------------- | ----------------------- | ------------------------------------------------------ |
| `.button-primary`   | Filled accent           | The one main action: sign in, save, confirm            |
| `.button-secondary` | Surface with a hairline | Other real actions: cancel, choose file, Mark reviewed |
| `.button-quiet`     | Text, hover background  | Low-key actions in toolbars and rows                   |
| `.button-danger`    | Filled red              | A destructive confirmation, only inside a question     |
| `button.link`       | Accent text             | Inline text actions                                    |

At most one `.button-primary` is visible at a time.

### Icon button

One `.icon-button`: 28×28 (32×32 on touch screens), `--r-sm`, a muted icon
that turns `--fg` on a `--hover` background. Modifiers: `.small` (22px, in
rows and fields), `.on` (a toggle that is on: accent icon), `.danger` (removes
something: red on hover). It stays lit while the menu it opens is open. Every
icon button has an `aria-label` and a `title`.

### Icons

Lucide icons at 14 (inline with meta and small text), 16 (buttons, menus,
fields) or 18 (navigation, toolbar). The stroke width is set once, in
`main.tsx`, and matches the hand-drawn icons in `Icons.tsx`; do not pass
`strokeWidth` per icon.

### States

| State               | Style                              | Where                                      |
| ------------------- | ---------------------------------- | ------------------------------------------ |
| Hover               | `--hover` background               | Rows, menu items, icon buttons, everything |
| Active (navigation) | `--surface` with `--shadow-1`      | Sidebar and review queue: "you are here"   |
| Selected            | `--selected` background            | Chosen tasks                               |
| Current in a list   | `--tint` background                | Search's active hit, a drop target         |
| Chosen option       | `--accent-fill` with `--on-accent` | A chip that is on                          |
| Keyboard focus      | `--focus-ring`                     | Every focusable control                    |

Menus do not fill on hover; a destructive menu item is red text with a faint
red hover.

### Section headings

One style for group titles, daypart headings, filter titles and panel
section labels: `--text-sm`, `--weight-strong`, `--muted`, no capitals. New
headings use `.section-heading`. A daypart heading adds a hairline and uses
`--fg`.

### Empty states

One component, `EmptyState` (`.empty-state`): a short title (strong) and one
sentence (`--text-sm`), both in `--muted`, nothing more. No illustrations, no
buttons that repeat what the toolbar already offers. Every empty list and
page uses it: the lists, a project, an area, the Logbook, Review with nothing
due and search without hits. Titles have no full stop; the sentence says what
will show up there. Loading and load errors are not empty states: they use
`.page-status`.

## Panes

Every pane shares one grammar, from `components/Pane.tsx`:

- **`PaneHeader`** (`.pane-head`): one row of `--pane-head` (48px), the
  title in `--text-sm` / `--weight-strong` at `--pane-pad-x` from the left,
  an optional count (`.pane-count`, a quiet pill), then `.icon-button`s on
  the right, and a hairline under it. All heads have the same height, so
  the first lines of the panes line up across the window. A head can hold
  something else in place of the title: a breadcrumb, a back button, the
  search field.
- **`Pane`** (`.pane`): the head, then `.pane-body` with `--pane-pad-y` /
  `--pane-pad-x` margins, scrolling on its own. A list of rows (the sidebar,
  the review list) uses `--pane-inset` instead, so the rows' icons line up
  with the head's title.

Where it is used:

| Pane        | Head                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| Sidebar     | "Dingen", Search, Collapse                                                               |
| Review list | "Review" with the count                                                                  |
| Content     | Breadcrumb on the left; the list's actions, a hairline, the page's own actions (desktop) |
| Task panel  | Where the task lives (project › heading, or area); `…` and Close. Back on a phone        |
| Settings    | The tab's name; Close                                                                    |
| Search      | The search field                                                                         |

**Actions live in the head on a desktop.** The content pane's head holds
the list's buttons (new task, new heading or project, When, Move, Tags,
Assign; with a selection the count and Delete) and, after a hairline, the
page's own (filter, focus, `…`, the review's "Mark reviewed"). Pages put
them there through `TaskToolbar` and `PageHeader`; what those buttons open
hangs under the head against its right edge. On a phone (≤720px) there is
no content head: the list's buttons stay in the toolbar at the bottom (with
Search), and the page's buttons sit on the title row.

**Breadcrumb.** `Crumb`, quiet (`--text-sm`, `--muted`), only where there
is a path: a project in an area shows "Area ›" (clicking goes there). Top
level lists and areas have none; the big title stays in the content.

**The rail.** On a desktop the sidebar folds to a `--rail` of icons
(`--rail-item` squares) with the button in its head (`PanelLeftClose`, next
to Search); on top of the rail the same button (`PanelLeftOpen`) unfolds it,
with Search under it and Settings at the bottom. Both carry `aria-expanded`,
and `[` does the same outside fields. The rail shows the lists (Review
between Someday and Logbook) and the areas, no projects; an area is lit on
its own page and on its projects' pages. An area with the default icon shows
its first letter in its colour, so areas stay apart. Every icon has its name
as `title` and `aria-label`, and still takes drops. The choice is the
user's, kept per device (`prefs.ts`); navigating never unfolds it. Folded,
there is no resize handle. Phones keep the drawer and have no fold button.

On `/review` the sidebar folds to the rail by itself and the review list
takes the sidebar's place at the sidebar's width (the handle sizes it), so
the window keeps its layout. The button works there too: unfolded, the full
sidebar and the review list sit side by side at one width, and the handle on
the sidebar's edge sizes both. Leaving the review brings back the user's own
choice. `--sidebar-room` follows the shape: the sidebar's width, the rail,
the rail plus the review list, or twice the sidebar's width. The columns move
with `--dur`; while resizing or with reduced motion they switch at once. The
rules live in `sidebarFold.ts`.

Review items have a second line in `--text-xs` / `--muted`: when the item
was last reviewed and how many tasks are open in it ("last reviewed 3 weeks
ago · 4 open"); it breaks at the dot rather than losing the count.

## Sheets

Every menu and popover is one component, `Sheet` in `Menu.tsx` (`.sheet`):
the `…` menus, the When picker, the filter, Review every, Move, Tags, Assign,
the area's look, New list, the toolbar's questions and the task panel's
field pickers. Do not build another floating surface.

- **Surface.** `--surface`, a hairline, `--r-lg`, `--shadow-2`, one padding
  (`--space-2`) and `--sheet-w` wide. A field picker in the task panel takes
  its field's width instead.
- **Placement.** It stays next to the button that opened it, in the DOM too,
  so click-outside and focus work as before. `align` (start, end, center,
  stretch) and `side` (below, above) place it; no positioning in other CSS.
- **Sections.** `SheetSection` groups content under a small heading in the
  `.section-heading` style (Planning, Organisation; When, Daypart). Fields,
  chips and text use `inset` to line up with the heading; rows (menu items,
  the move list) bring their own inset. `SheetDivider` is the hairline.
- **Menu items.** `.menu-item`: a 16px icon in `--muted`, the label, and on the
  right the key that does the same outside the menu (`.menu-kbd`), only where
  the app has one. Items with the same `section` sit together under its
  heading. A destructive item is red, and always last, under a hairline.
- **Closing.** Escape and a click outside close it (`useDismiss`) and focus
  goes back to the button; choosing closes it where that is the natural end.
- **Phones** (720px and narrower). The same sheet comes up from the bottom:
  the whole width, `--r-lg` on top, a grab handle, over `--scrim`, with
  room for the safe area. It slides up in `--dur`; with reduced motion it
  just appears. A tap on the scrim or a swipe down closes it; Escape still
  does. Rows get more height for the thumb.

## Adding UI: a checklist

1. Is there already a component for this job? Use it.
2. Every colour, space, size, weight, radius, shadow and duration is a token.
   A new value means a new token with a reason, in both light and dark.
3. Buttons ask for a variant; icon-only buttons are `.icon-button` with an
   `aria-label`.
4. Icons are 14, 16 or 18, without their own stroke width.
5. Hover is `--hover`; "you are here" is the active card; focus is the ring.
6. Narrow-screen rules go in the one `@media (max-width: 720px)` block at the
   end of `styles.css`.
7. Look at it in light and dark, on a desktop and at phone width.
