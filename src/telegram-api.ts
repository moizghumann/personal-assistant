export type TelegramReply = {
  updateId: number
  chatId: number
  messageId: number
  threadId?: number
  directTopicId?: number
  text: string
}

type TelegramReplyIds = Omit<TelegramReply, 'text'>

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
    throw new Error('Telegram sendMessage request failed')
  }

  if (!response.ok) throw new Error(`Telegram sendMessage failed (HTTP ${response.status})`)
  const result = await response.json().catch(() => null) as { ok?: unknown } | null
  if (result?.ok !== true) {
    throw new Error(`Telegram sendMessage failed (HTTP ${response.status})`)
  }
}
