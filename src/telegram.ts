import { Hono } from 'hono'
import { timingSafeEqual } from 'hono/utils/buffer'

type TelegramUpdate = {
  update_id?: unknown
  message?: {
    message_id?: unknown
    chat?: { id?: unknown }
    is_topic_message?: boolean
    message_thread_id?: unknown
    direct_messages_topic?: { topic_id?: unknown }
  }
}

const telegram = new Hono()

telegram.post('/webhook', async (c) => {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
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

  const chatId = message?.chat?.id
  const messageId = message?.message_id
  const threadId = message?.is_topic_message === true ? message.message_thread_id : undefined
  const directTopicId = message?.direct_messages_topic?.topic_id
  if (
    !Number.isSafeInteger(chatId) ||
    !Number.isSafeInteger(messageId) ||
    (threadId !== undefined && !Number.isSafeInteger(threadId)) ||
    (directTopicId !== undefined && !Number.isSafeInteger(directTopicId))
  ) {
    return c.text('Invalid Telegram message', 400)
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/copyMessages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          from_chat_id: chatId,
          message_ids: [messageId],
          message_thread_id: threadId,
          direct_messages_topic_id: directTopicId,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      },
    )
    const result = await response.json() as { ok?: boolean } | null
    if (response.ok && result?.ok === true) return c.body(null, 204)

    console.error('Telegram copyMessages failed', response.status)
  } catch {
    console.error('Telegram copyMessages request failed')
  }

  return c.text('Telegram echo failed', 502)
})

export default telegram
