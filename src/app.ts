import { Hono } from 'hono'
import { generateTestAnswer } from './ai.js'
import { receiveTelegramWebhook } from './telegram.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Railway!')
})

app.get('/marco', (c) => {
  return c.text('polo')
})

app.post('/telegram/webhook', receiveTelegramWebhook)

let cachedTest: { expiresAt: number; answer: Promise<string> } | undefined

app.get('/test/ai', async (c) => {
  c.header('Cache-Control', 'no-store')
  const { NEON_AI_GATEWAY_BASE_URL, NEON_AI_GATEWAY_TOKEN } = process.env
  if (!NEON_AI_GATEWAY_BASE_URL || !NEON_AI_GATEWAY_TOKEN) {
    return c.text('Neon AI Gateway is not configured', 503)
  }

  const now = Date.now()
  if (!cachedTest || cachedTest.expiresAt <= now) {
    // shortcut: share one attempt per process per minute until this temporary route is removed.
    cachedTest = {
      expiresAt: now + 60_000,
      answer: generateTestAnswer({ NEON_AI_GATEWAY_BASE_URL, NEON_AI_GATEWAY_TOKEN }),
    }
  }

  try {
    return c.text(await cachedTest.answer)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return c.text('AI test timed out', 504)
    }
    console.error('AI test generation failed')
    return c.text('AI test could not generate a response', 502)
  }
})

export default app
