import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/** What's New: release CI writes build/changelog.json (scripts/changelog.mjs); other builds have none. */
const changelogFile = resolve('build/changelog.json')
const changelog = existsSync(changelogFile) ? JSON.parse(readFileSync(changelogFile, 'utf8')) : {}

export default defineConfig({
  main: {
    define: { __CHANGELOG__: JSON.stringify(changelog) },
    build: {
      externalizeDeps: true,
      rollupOptions: { input: { index: resolve('src/main/index.ts') } }
    }
  },
  preload: {
    build: {
      // Sandboxed preloads can only require('electron'): bundle the rest.
      externalizeDeps: { exclude: ['electron-chrome-extensions'] },
      rollupOptions: { input: { ui: resolve('src/preload/ui.ts'), 'extension-browser': resolve('src/preload/extension-browser.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
          little: resolve('src/renderer/little.html'),
          prompt: resolve('src/renderer/prompt.html'),
          float: resolve('src/renderer/float.html')
        }
      }
    }
  }
})
