import { Hono } from 'hono'
import { timingSafeEqual } from 'hono/utils/buffer'
import { generateTestAnswer } from '../ai.js'
import { isTelegramReply } from '../telegram-api.js'

export { AiTest } from './workflows/ai-test.js'
export { HelloWorld } from './workflows/hello-world.js'
export { TelegramReplyWorkflow } from './workflows/telegram-reply.js'

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  const token = c.req.header('Authorization')
  if (!c.env.AGENT_WORKER_TOKEN || !token || !await timingSafeEqual(token, `Bearer ${c.env.AGENT_WORKER_TOKEN}`)) {
    return c.text('Unauthorized', 401)
  }
  await next()
})

app.get('/test/ai', async (c) => {
  if (!c.env.NEON_AI_GATEWAY_BASE_URL || !c.env.NEON_AI_GATEWAY_TOKEN) {
    return c.text('Neon AI Gateway is unavailable', 503)
  }
  try {
    return c.text(await generateTestAnswer(c.env))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return c.text('AI test timed out', 504)
    }
    console.error('AI test generation failed')
    return c.text('AI test could not generate a response', 502)
  }
})

app.post('/telegram', async (c) => {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.NEON_AI_GATEWAY_BASE_URL || !c.env.NEON_AI_GATEWAY_TOKEN) {
    return c.text('Telegram agent is unavailable', 503)
  }
  const message = await c.req.json().catch(() => null)
  if (!isTelegramReply(message)) return c.text('Invalid Telegram reply payload', 400)

  try {
    await c.env.TELEGRAM_REPLY.create({ id: `telegram-${message.updateId}`, params: message })
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('(instance.already_exists)')) {
      console.error('Telegram workflow could not be started')
      return c.text('Telegram workflow unavailable', 503)
    }
  }
  return c.body(null, 202)
})

export default app
