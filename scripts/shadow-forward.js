import { runShadowCommand } from '../server/shadowForwardCommand.js'

// Explicit standalone entry point; never imported by API or paper worker.
try {
  const worker = await runShadowCommand(process.argv.slice(2))
  if (worker) {
    let stopping = false
    const stop = async () => { if (stopping) return; stopping = true; await worker.close() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
} catch {
  console.error('Shadow command failed. Check required configuration, initialization, source compatibility and database access. No credentials are logged.')
  process.exitCode = 1
}
