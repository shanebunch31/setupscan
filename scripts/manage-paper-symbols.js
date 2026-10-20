import dotenv from 'dotenv'
import { createPostgresPaperStore, describeDatabaseUrl } from '../server/postgresPaperStore.js'
import { paperSymbolErrorMessage, runPaperSymbolCommand } from '../server/paperSymbolCli.js'

dotenv.config()
try {
  const result = await runPaperSymbolCommand({
    args: process.argv.slice(2),
    environment: process.env,
    createStore: () => createPostgresPaperStore(),
    describeDatabase: describeDatabaseUrl,
  })
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(paperSymbolErrorMessage(error))
  process.exitCode = 2
}
