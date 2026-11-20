#!/usr/bin/env node
/**
 * Fixed screenshots of the demo, in light and dark, for the website.
 *
 * Builds the app, starts the server in demo mode on a free port with a temporary
 * DATA_DIR, signs in as the demo account Sam Rivera and captures every shot in SHOTS as
 * WebP. Afterwards the server stops and the temporary data is removed.
 *
 *   node scripts/screenshots/capture.mjs [--out DIR] [--only NAME,...] [--skip-build]
 *
 * Needs Google Chrome (or CHROME_PATH pointing at a Chromium-based browser).
 * See README.md next to this file.
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version
const DEMO_EMAIL = 'sam@example.com'
const WEBP_QUALITY = 0.9

// --- the shots --------------------------------------------------------------------------

/**
 * Each shot: a window size in CSS pixels (`viewport`), optionally a `crop` of the content
 * column in CSS pixels, the output widths in pixels and a `prepare` step that opens the view. File names: `<name>-<scheme>-<width>.webp`, or `file` for a fixed name.
 */
const SHOTS = [
  {
    name: 'today',
    description: 'Today view with the sidebar (hero)',
    viewport: { width: 1300, height: 1013 },
    widths: [1300, 2200],
    prepare: async (page) => {
      await openList(page, 'Today')
    },
  },
  {
    name: 'review',
    description: 'Review page: icon rail, review list, one project selected',
    viewport: { width: 1100, height: 939 },
    widths: [750, 1500],
    prepare: async (page) => {
      await openList(page, 'Review')
      await page.locator('.review-queue').getByText('Crumb & Co. website', { exact: true }).click()
      await visibleText(page, 'Homepage design').waitFor()
    },
  },
  {
    name: 'project',
    description: 'A project page with headings (content column)',
    viewport: { width: 1300, height: 1013 },
    widths: [750, 1500],
    prepare: async (page) => {
      await openSidebarItem(page, 'Crumb & Co. website')
      await visibleText(page, 'Homepage design').waitFor()
    },
    crop: { width: 750, height: 640 },
  },
  {
    name: 'upcoming',
    description: 'Upcoming (content column)',
    viewport: { width: 1300, height: 1013 },
    widths: [750, 1500],
    prepare: async (page) => {
      await openList(page, 'Upcoming')
    },
    crop: { width: 750, height: 640 },
  },
  {
    name: 'task',
    description: 'A project with the task panel open',
    viewport: { width: 1300, height: 1013 },
    widths: [1300, 2200],
    prepare: async (page) => {
      await openSidebarItem(page, 'Crumb & Co. website')
      await visibleText(page, 'Homepage design').dblclick()
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'mobile-today',
    description: 'Today on a phone',
    viewport: { width: 390, height: 844 },
    mobile: true,
    widths: [600],
    // The website has used one light phone shot under this name.
    file: (scheme) => (scheme === 'light' ? 'mobile-today.webp' : 'mobile-today-dark.webp'),
    prepare: async (page) => {
      await page.goto(`${baseUrl}/today`)
      await settle(page)
    },
  },
]

// --- views ------------------------------------------------------------------------------

/** Opens a list from the sidebar (or the icon rail) by its label. */
async function openList(page, label) {
  await page.goto(`${baseUrl}/${label.toLowerCase()}`)
  await settle(page)
}

function visibleText(page, text) {
  return page.getByText(text, { exact: true }).filter({ visible: true }).first()
}

async function openSidebarItem(page, label) {
  await page.goto(`${baseUrl}/today`)
  await settle(page)
  await page.locator('.sidebar').getByText(label, { exact: true }).first().click()
  await settle(page)
}

/**
 * A crop of the content column: from just left of the page title, `size` wide and high.
 * Keeps the shot about the list itself, as the website's smaller shots are.
 */
async function contentClip(page, size) {
  const box = await page.locator('.page-header-title, h1').first().boundingBox()
  if (!box) throw new Error('No page title to crop from')
  const x = Math.max(0, Math.round(box.x - 85))
  // From just under the toolbar, so its buttons are not cut in half.
  const bar = await page.locator('.content-head').filter({ visible: true }).first().boundingBox()
  const y = bar ? Math.round(bar.y + bar.height + 1) : 0
  return { x, y, width: size.width, height: size.height }
}

// --- page helpers -----------------------------------------------------------------------

/** No caret, no transitions, no animations: nothing caught halfway. */
const STILL_CSS = `
  *, *::before, *::after {
    caret-color: transparent !important;
    transition: none !important;
    animation: none !important;
  }
`

async function settle(page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  // The sync engine says "Synced" once the first pull is in.
  await page
    .locator('.sync-status.synced, .sync-status.idle')
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {})
  await page.waitForTimeout(300)
}

/** Volatile bits made fixed: the version label without a build hash, the mouse out of sight. */
async function normalise(page) {
  await page.evaluate((label) => {
    for (const el of document.querySelectorAll('.app-version')) el.textContent = label
    document.activeElement?.blur?.()
  }, `Dingen ${version}`)
  await page.mouse.move(-10, -10).catch(() => {})
  await page.waitForTimeout(200)
}

async function signIn(context) {
  const page = await context.newPage()
  await page.goto(`${baseUrl}/`)
  const status = await page.evaluate(async (email) => {
    const res = await fetch(`/api/auth/demo/${encodeURIComponent(email)}`, { method: 'POST' })
    return res.status
  }, DEMO_EMAIL)
  if (status !== 200) throw new Error(`Demo sign-in failed (${status})`)
  return page
}

/** PNG to WebP with the browser's own encoder, so no image library is needed. */
async function toWebp(encoder, png) {
  const dataUrl = await encoder.evaluate(
    async ({ b64, quality }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      return canvas.toDataURL('image/webp', quality)
    },
    { b64: png.toString('base64'), quality: WEBP_QUALITY },
  )
  if (!dataUrl.startsWith('data:image/webp')) throw new Error('This browser cannot encode WebP')
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

// --- server -----------------------------------------------------------------------------

let baseUrl = ''

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function startServer(dataDir, port) {
  const child = spawn(process.execPath, [path.join(repo, 'apps/server/dist/index.js')], {
    cwd: repo,
    env: {
      ...process.env,
      DINGEN_DEMO: '1',
      DATA_DIR: dataDir,
      PORT: String(port),
      DINGEN_VERSION: version,
      DINGEN_BACKUPS: 'off',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => {
    log += d
  })
  child.stderr.on('data', (d) => {
    log += d
  })
  const url = `http://localhost:${port}`
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited:\n${log}`)
    try {
      const res = await fetch(`${url}/api/auth/status`)
      if (res.ok && (await res.json()).demo) return { child, url }
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  child.kill()
  throw new Error(`Server did not start:\n${log}`)
}

function build() {
  console.log(`Building (version ${version})...`)
  const env = { ...process.env, DINGEN_VERSION: version }
  for (const filter of ['@dingen/web...', '@dingen/server...']) {
    const r = spawnSync('pnpm', ['--filter', filter, 'build'], { cwd: repo, env, stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`Build failed: ${filter}`)
  }
}

// --- main -------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { out: path.join(repo, 'scripts/screenshots/out'), only: null, build: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = path.resolve(argv[++i])
    else if (a === '--only') args.only = argv[++i].split(',')
    else if (a === '--skip-build') args.build = false
    else if (a === '--help' || a === '-h') {
      console.log('Usage: capture.mjs [--out DIR] [--only today,review,...] [--skip-build]')
      console.log(`Shots: ${SHOTS.map((s) => s.name).join(', ')}`)
      process.exit(0)
    } else throw new Error(`Unknown argument: ${a}`)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const shots = args.only ? SHOTS.filter((s) => args.only.includes(s.name)) : SHOTS
  if (shots.length === 0) throw new Error('No shots selected')
  if (args.build) build()
  fs.mkdirSync(args.out, { recursive: true })

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-screenshots-'))
  let server = null
  let browser = null
  try {
    server = await startServer(dataDir, await freePort())
    baseUrl = server.url
    console.log(`Demo server on ${baseUrl}`)
    browser = process.env.CHROME_PATH
      ? await chromium.launch({ executablePath: process.env.CHROME_PATH })
      : await chromium.launch({ channel: 'chrome' })
    const encoder = await (await browser.newContext()).newPage()

    // Today's "new tasks" banner is seen once, so it does not cover the hero.
    {
      const ctx = await browser.newContext()
      const page = await signIn(ctx)
      await page.evaluate(async () => {
        const d = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        await fetch('/api/auth/today-seen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: today }),
        })
      })
      await ctx.close()
    }

    const written = []
    for (const shot of shots) {
      for (const scheme of ['light', 'dark']) {
        for (const width of shot.widths) {
          // The scale is set so the result is exactly `width` pixels wide.
          const scale = width / (shot.crop ?? shot.viewport).width
          const context = await browser.newContext({
            viewport: shot.viewport,
            deviceScaleFactor: scale,
            colorScheme: scheme,
            reducedMotion: 'reduce',
            isMobile: shot.mobile ?? false,
            hasTouch: shot.mobile ?? false,
            locale: 'en-GB',
            timezoneId: 'Europe/Amsterdam',
          })
          await context.addInitScript((css) => {
            document.addEventListener('DOMContentLoaded', () => {
              const style = document.createElement('style')
              style.textContent = css
              document.head.append(style)
            })
          }, STILL_CSS)
          const page = await signIn(context)
          try {
            await shot.prepare(page)
          } catch (err) {
            // What the page looked like when the step failed, to see why.
            await page.screenshot({ path: path.join(args.out, `${shot.name}-failed.png`) })
            throw err
          }
          await normalise(page)
          const clip = shot.crop ? await contentClip(page, shot.crop) : undefined
          const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
          const file = shot.file ? shot.file(scheme, width) : `${shot.name}-${scheme}-${width}.webp`
          fs.writeFileSync(path.join(args.out, file), await toWebp(encoder, png))
          written.push(file)
          console.log(`  ${file}`)
          await context.close()
        }
      }
    }
    console.log(`${written.length} files in ${args.out}`)
  } finally {
    await browser?.close().catch(() => {})
    if (server) {
      server.child.kill('SIGTERM')
      await new Promise((r) => {
        if (server.child.exitCode !== null) return r()
        server.child.once('exit', r)
        setTimeout(r, 5000)
      })
    }
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
