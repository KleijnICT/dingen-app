import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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

export default defineConfig({
  plugins: [react()],
  define: {
    __DINGEN_VERSION__: JSON.stringify(appVersion()),
    __DINGEN_BUILD__: JSON.stringify(appBuild()),
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
})
