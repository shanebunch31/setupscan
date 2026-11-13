import { safeShadowFailure } from '../server/shadowForwardObserver.js'
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
} catch (error) {
  const failure = safeShadowFailure(error)
  console.error(`Shadow command failed; code=${failure.code}; manualReview=${failure.manualReviewRequired}. No credentials are logged.`)
  process.exitCode = 1
}
