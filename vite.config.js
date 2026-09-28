import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { buildRevisionDefine, resolveBuildRevision } from './src/config/buildRevision.js'

function readGitSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

const buildRevision = resolveBuildRevision(process.env.GIT_COMMIT_SHA, readGitSha)

export default defineConfig({
  plugins: [react()],
  define: buildRevisionDefine(buildRevision),
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
})
