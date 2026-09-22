import dotenv from 'dotenv'
import http from 'node:http'
import { createPaperObserver } from './paperObserverCore.js'

dotenv.config()
const port = Number(process.env.OBSERVER_PORT || 3102)
const observer = await createPaperObserver()

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const server = http.createServer((request, response) => {
  if (request.url === '/health' || request.url === '/api/paper-observer/status') {
    sendJson(response, 200, observer.status())
    return
  }
  sendJson(response, 404, { error: 'Not found' })
})

server.listen(port, () => {
  console.log('AUTOMATED PAPER OBSERVER — NO REAL ORDERS')
  console.log(`Observer status listening on http://localhost:${port}`)
  observer.start()
})

process.on('SIGTERM', () => { observer.stop(); server.close(() => process.exit(0)) })
process.on('SIGINT', () => { observer.stop(); server.close(() => process.exit(0)) })
