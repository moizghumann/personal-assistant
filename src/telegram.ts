import type { Context } from 'hono'
import { timingSafeEqual } from 'hono/utils/buffer'
import { generateTelegramAnswer } from './ai.js'
import { parseTelegramUpdate, sendTelegramReply } from './telegram-api.js'

export async function receiveTelegramWebhook(c: Context) {
  const { TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, NEON_AI_GATEWAY_BASE_URL, NEON_AI_GATEWAY_TOKEN } = process.env
  if (!TELEGRAM_WEBHOOK_SECRET || !TELEGRAM_BOT_TOKEN) {
    return c.text('Telegram webhook is not configured', 503)
  }

  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (!secret || !await timingSafeEqual(secret, TELEGRAM_WEBHOOK_SECRET)) {
    return c.text('Unauthorized', 401)
  }

  const message = parseTelegramUpdate(await c.req.json().catch(() => null))
  if (typeof message === 'string') return c.text(message, 400)
  if (!message) return c.body(null, 204)

  if (!NEON_AI_GATEWAY_BASE_URL || !NEON_AI_GATEWAY_TOKEN) {
    return c.text('Neon AI Gateway is not configured', 503)
  }

  const reply = await generateTelegramAnswer({ NEON_AI_GATEWAY_BASE_URL, NEON_AI_GATEWAY_TOKEN }, message.text)
  try {
    await sendTelegramReply(TELEGRAM_BOT_TOKEN, message, reply)
    return c.body(null, 204)
  } catch {
    console.error('Telegram sendMessage failed')
    return c.text('Telegram reply failed', 502)
  }
}
