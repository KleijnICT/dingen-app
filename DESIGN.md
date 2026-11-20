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
| `--rail`                                                | 56px            | The sidebar folded to icons               |
| `--sidebar-default`, `--panel-default`, `--content-max` | 220, 420, 640px | Default column widths                     |

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

### Popovers

`.popover` gives the surface, hairline border, `--r-lg` and `--shadow-2`.
Menus use `.menu` inside a `.more-menu` with `.menu-item` rows.

### Empty states

A title and one sentence, in `--muted`, nothing more. No illustrations, no
buttons that repeat what the toolbar already offers.

## Panes (coming)

_Placeholder._ Every pane (sidebar, review queue, task panel, settings,
search) will share one grammar: a head of `--pane-head` with a title, an
optional count and icon buttons on the right, a hairline, and the content
with `--pane-pad-x` / `--pane-pad-y` margins. In the review the sidebar
folds to a `--rail` of icons. This section is filled in when the pane
components land.

## Sheets (coming)

_Placeholder._ Menus and popovers will become one sheet component: sections
with a small heading, shortcuts on the right, and a sheet from the bottom on
phones. This section is filled in when the sheet component lands.

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
