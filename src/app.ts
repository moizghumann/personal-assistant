import { Hono } from 'hono'
import { receiveTelegramWebhook } from './telegram.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Railway!')
})

app.get('/marco', (c) => {
  return c.text('polo')
})

app.post('/telegram/webhook', receiveTelegramWebhook)

app.get('/test/ai', async (c) => {
  c.header('Cache-Control', 'no-store')
  const { AGENT_WORKER_URL, AGENT_WORKER_TOKEN } = process.env
  if (!AGENT_WORKER_URL || !AGENT_WORKER_TOKEN) {
    return c.text('Cloudflare agent is not configured', 503)
  }

  const prompt = c.req.query('prompt')?.trim() ?? ''
  try {
    const response = await fetch(new URL('/test/ai', AGENT_WORKER_URL), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AGENT_WORKER_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    })
    const workflowId = response.headers.get('X-Workflow-Id')
    if (workflowId) c.header('X-Workflow-Id', workflowId)
    if (response.ok) return c.text(await response.text())
    if (response.status === 504) return c.text('AI test timed out', 504)
    if (response.status === 503) return c.text('Cloudflare agent is unavailable', 503)
    console.error('Cloudflare agent returned an error', response.status)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return c.text('AI test timed out', 504)
    }
    console.error('Cloudflare agent request failed')
  }
  return c.text('AI test could not generate a response', 502)
})

export default app
