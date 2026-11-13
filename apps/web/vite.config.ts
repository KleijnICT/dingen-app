import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Version and build of this bundle, shown in the sidebar. */
function appVersion(): string {
  if (process.env.DINGEN_VERSION) return process.env.DINGEN_VERSION
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  return `${pkg.version}-dev`
}

function appBuild(): string | null {
  if (process.env.DINGEN_COMMIT) return process.env.DINGEN_COMMIT
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

/**
 * Emits /sw.js: the service worker from sw/sw.js with the build number and the list of files
 * to precache filled in. Hashed bundle names change per build, so the worker changes too and
 * the browser sees an update.
 */
function serviceWorker(): Plugin {
  return {
    name: 'dingen-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'))
      const precache = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icon.svg',
        ...files.map((f) => `/${f}`),
      ]
      const publicFiles = [
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'apple-touch-icon.png',
      ]
      precache.push(...publicFiles.map((f) => `/${f}`))
      const hasher = createHash('sha256')
      for (const name of files.sort()) {
        const item = bundle[name]
        if (!item) continue
        hasher.update(name)
        hasher.update(item.type === 'chunk' ? item.code : item.source)
      }
      const hash = hasher.digest('hex').slice(0, 12)
      const template = readFileSync(new URL('./sw/sw.js', import.meta.url), 'utf8')
      const build = `${appVersion()}-${appBuild() ?? 'dev'}-${hash}`
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__DINGEN_SW_BUILD__', build)
          .replace('__DINGEN_SW_PRECACHE__', JSON.stringify([...new Set(precache)])),
      })
    },
  }
}

export default defineConfig({
  // Relative asset URLs, so the app also works under a path prefix (Home Assistant ingress).
  // The server puts a <base href> in index.html; see apps/server/src/static.ts.
  base: './',
  plugins: [react(), serviceWorker()],
  define: {
    __DINGEN_VERSION__: JSON.stringify(appVersion()),
    __DINGEN_BUILD__: JSON.stringify(appBuild()),
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
})
