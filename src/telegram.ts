import type { Context } from 'hono'
import { timingSafeEqual } from 'hono/utils/buffer'
import { generateTelegramAnswer } from './ai.js'
import { hasTelegramReplyIds, sendTelegramReply } from './telegram-api.js'

type TelegramUpdate = {
  update_id?: unknown
  message?: {
    message_id?: unknown
    text?: unknown
    chat?: { id?: unknown }
    is_topic_message?: boolean
    message_thread_id?: unknown
    direct_messages_topic?: { topic_id?: unknown }
  }
}

export async function receiveTelegramWebhook(c: Context) {
  const { TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, NEON_AI_GATEWAY_BASE_URL, NEON_AI_GATEWAY_TOKEN } = process.env
  if (!TELEGRAM_WEBHOOK_SECRET || !TELEGRAM_BOT_TOKEN) {
    return c.text('Telegram webhook is not configured', 503)
  }

  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (!secret || !await timingSafeEqual(secret, TELEGRAM_WEBHOOK_SECRET)) {
    return c.text('Unauthorized', 401)
  }

  const update = await c.req.json<TelegramUpdate>().catch(() => null)
  if (!update || !Number.isSafeInteger(update.update_id)) {
    return c.text('Invalid Telegram update', 400)
  }

  const message = update.message
  if (message === undefined) return c.body(null, 204)

  const ids = {
    updateId: update.update_id,
    chatId: message?.chat?.id,
    messageId: message?.message_id,
    threadId: message?.is_topic_message === true ? message.message_thread_id : undefined,
    directTopicId: message?.direct_messages_topic?.topic_id,
  }
  if (!hasTelegramReplyIds(ids)) return c.text('Invalid Telegram message', 400)
  if (typeof message.text !== 'string' || !message.text.trim()) return c.body(null, 204)

  if (!NEON_AI_GATEWAY_BASE_URL || !NEON_AI_GATEWAY_TOKEN) {
    return c.text('Neon AI Gateway is not configured', 503)
  }

  const reply = await generateTelegramAnswer({ NEON_AI_GATEWAY_BASE_URL, NEON_AI_GATEWAY_TOKEN }, message.text)
  try {
    await sendTelegramReply(TELEGRAM_BOT_TOKEN, { ...ids, text: message.text }, reply)
    return c.body(null, 204)
  } catch {
    console.error('Telegram sendMessage failed')
    return c.text('Telegram reply failed', 502)
  }
}
