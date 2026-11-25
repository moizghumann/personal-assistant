export type TelegramReply = {
  updateId: number
  chatId: number
  messageId: number
  threadId?: number
  directTopicId?: number
  text: string
}

type TelegramReplyIds = Omit<TelegramReply, 'text'>

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

export function parseTelegramUpdate(input: unknown): TelegramReply | string | null {
  const update = input as TelegramUpdate | null
  if (!update || !Number.isSafeInteger(update.update_id)) return 'Invalid Telegram update'
  const message = update.message
  if (message === undefined) return null

  const ids = {
    updateId: update.update_id,
    chatId: message?.chat?.id,
    messageId: message?.message_id,
    threadId: message?.is_topic_message === true ? message.message_thread_id : undefined,
    directTopicId: message?.direct_messages_topic?.topic_id,
  }
  if (!hasTelegramReplyIds(ids)) return 'Invalid Telegram message'
  if (typeof message.text !== 'string' || !message.text.trim()) return null
  return { ...ids, text: message.text }
}

export function hasTelegramReplyIds(reply: Partial<Record<keyof TelegramReplyIds, unknown>>): reply is TelegramReplyIds {
  return Number.isSafeInteger(reply.updateId) &&
    Number.isSafeInteger(reply.chatId) &&
    Number.isSafeInteger(reply.messageId) &&
    (reply.threadId === undefined || Number.isSafeInteger(reply.threadId)) &&
    (reply.directTopicId === undefined || Number.isSafeInteger(reply.directTopicId))
}

export function isTelegramReply(input: unknown): input is TelegramReply {
  if (!input || typeof input !== 'object') return false
  const reply = input as Partial<TelegramReply>
  return typeof reply.text === 'string' && Boolean(reply.text.trim()) && hasTelegramReplyIds(reply)
}

export class TelegramRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Telegram sendMessage failed (HTTP 429)')
  }
}

export class TelegramRejectedError extends Error {
  constructor(status: number) {
    super(`Telegram rejected reply (HTTP ${status})`)
  }
}

export async function sendTelegramTyping(token: string, message: TelegramReply) {
  // Telegram excludes channel direct-message chats from sendChatAction.
  if (message.directTopicId !== undefined) return
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: message.chatId,
      message_thread_id: message.threadId,
      action: 'typing',
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(1_500),
  }).catch(() => {})
}

export async function sendTelegramReply(token: string, message: TelegramReply, text: string) {
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chatId,
        text,
        message_thread_id: message.threadId,
        direct_messages_topic_id: message.directTopicId,
        reply_parameters: { message_id: message.messageId, allow_sending_without_reply: true },
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new Error('Telegram delivery unknown (no response)')
  }

  const result = await response.json().catch(() => null) as {
    ok?: unknown
    error_code?: unknown
    parameters?: { retry_after?: unknown }
    result?: { message_id?: unknown }
  } | null
  if (response.status === 429 && result?.ok === false && result.error_code === 429) {
    const delay = result.parameters?.retry_after
    throw new TelegramRateLimitError(typeof delay === 'number' && Number.isSafeInteger(delay) && delay > 0 ? delay : 1)
  }
  if (response.status >= 400 && response.status < 500 && result?.ok === false && result.error_code === response.status) {
    throw new TelegramRejectedError(response.status)
  }
  const id = result?.result?.message_id
  if (response.ok && result?.ok === true && typeof id === 'number' && Number.isSafeInteger(id)) return id
  throw new Error(`Telegram delivery unknown (HTTP ${response.status})`)
}
