# Screenshots

Fixed screenshots of the demo for the website, in light and dark, made the same way every
time.

```sh
pnpm screenshots                                   # everything, into scripts/screenshots/out
pnpm screenshots --out ~/Desktop/shots             # somewhere else
pnpm screenshots --only today,review --skip-build  # a few shots, without building first
```

The script (`capture.mjs`):

1. builds the web app and the server with `DINGEN_VERSION` set to the version in the root
   `package.json` (skip with `--skip-build`);
2. starts the server in demo mode (`DINGEN_DEMO=1`) on a free port with a temporary
   `DATA_DIR`;
3. signs in as the demo account Sam Rivera and marks Today's "new tasks" banner as seen;
4. opens each view in a fresh browser window, light and dark (`prefers-color-scheme`), at
   each output width, and saves it as WebP;
5. stops the server and removes the temporary data.

It uses the installed Google Chrome through `playwright-core` (a root dev dependency, no
browser download). Set `CHROME_PATH` to use another Chromium-based browser.

## The shots

| File                                          | Window (CSS px) | What                                               |
| --------------------------------------------- | --------------- | -------------------------------------------------- |
| `today-{light,dark}-{1300,2200}.webp`         | 1300 × 1013     | Today with the sidebar (hero)                      |
| `review-{light,dark}-{750,1500}.webp`         | 1100 × 939      | Review: icon rail, review list, a project selected |
| `project-{light,dark}-{750,1500}.webp`        | 750 × 640 crop  | A project with headings                            |
| `upcoming-{light,dark}-{750,1500}.webp`       | 750 × 640 crop  | Upcoming                                           |
| `task-{light,dark}-{1300,2200}.webp`          | 1300 × 1013     | A project with the task panel open                 |
| `mobile-today.webp`, `mobile-today-dark.webp` | 390 × 844       | Today on a phone, 600 px wide                      |

Every width is rendered at its own device scale, not scaled down afterwards, so text stays
sharp. Animations, transitions and the text caret are off, the mouse is out of the window,
and the version label reads `Dingen <version>` without a build hash.

The demo's dates are relative to the day the script runs, so weekday names and dates in the
shots follow the calendar. To add or change a shot, edit `SHOTS` at the top of
`capture.mjs`. When a view fails to open, the script leaves `<name>-failed.png` in the output
folder to show where it got stuck.
