export type TelegramAttachment = { fileId: string; name: string; mimeType?: string; size?: number }
export type TelegramDocument = { name: string; bytes: ArrayBuffer }

export type TelegramReply = {
  updateId: number
  chatId: number
  messageId: number
  threadId?: number
  directTopicId?: number
  text: string
  attachment?: TelegramAttachment
  repliedAttachment?: TelegramAttachment
}

type TelegramReplyIds = Pick<TelegramReply, 'updateId' | 'chatId' | 'messageId' | 'threadId' | 'directTopicId'>

type TelegramFile = { file_id?: unknown; file_name?: unknown; mime_type?: unknown; file_size?: unknown }
type TelegramMedia = { document?: TelegramFile; photo?: TelegramFile[] }

type TelegramUpdate = {
  update_id?: unknown
  message?: TelegramMedia & {
    message_id?: unknown
    text?: unknown
    caption?: unknown
    reply_to_message?: TelegramMedia
    chat?: { id?: unknown }
    is_topic_message?: boolean
    message_thread_id?: unknown
    direct_messages_topic?: { topic_id?: unknown }
  }
}

export function parseTelegramUpdate(input: unknown, acceptFiles = false): TelegramReply | string | null {
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
  const attachment = acceptFiles ? telegramAttachment(message) : undefined
  const repliedAttachment = acceptFiles ? telegramAttachment(message.reply_to_message) : undefined
  const text = typeof message.text === 'string' ? message.text.trim() : undefined
  const caption = attachment && typeof message.caption === 'string' ? message.caption.trim() : undefined
  if (!text && !attachment) return null
  return {
    ...ids,
    text: text ? message.text as string : caption || 'I uploaded a file.',
    ...(attachment && { attachment }),
    ...(repliedAttachment && { repliedAttachment }),
  }
}

function telegramAttachment(message?: TelegramMedia): TelegramAttachment | undefined {
  const photo = Array.isArray(message?.photo) ? message.photo.at(-1) : undefined
  const file = message?.document ?? photo
  if (!file) return undefined
  const attachment = {
    fileId: file.file_id,
    name: file.file_name ?? (photo ? 'photo.jpg' : 'attachment'),
    mimeType: file.mime_type ?? (photo ? 'image/jpeg' : undefined),
    size: file.file_size,
  }
  return isTelegramAttachment(attachment) ? attachment : undefined
}

function isTelegramAttachment(value: unknown): value is TelegramAttachment {
  if (!value || typeof value !== 'object') return false
  const { fileId, name, mimeType, size } = value as Partial<TelegramAttachment>
  return typeof fileId === 'string' && fileId.length <= 512 && /^[a-zA-Z0-9_-]+$/.test(fileId) &&
    typeof name === 'string' && name.length > 0 && name.length <= 255 && !/[\x00-\x1f\x7f]/.test(name) &&
    (mimeType === undefined || (typeof mimeType === 'string' && mimeType.length <= 127)) &&
    (size === undefined || (Number.isSafeInteger(size) && size >= 0))
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
  return typeof reply.text === 'string' && Boolean(reply.text.trim()) &&
    (reply.attachment === undefined || isTelegramAttachment(reply.attachment)) &&
    (reply.repliedAttachment === undefined || isTelegramAttachment(reply.repliedAttachment)) &&
    hasTelegramReplyIds(reply)
}

export class TelegramRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Telegram reply rate limited (HTTP 429)')
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

export async function sendTelegramReply(token: string, message: TelegramReply, text: string, document?: TelegramDocument) {
  const fields = {
    chat_id: message.chatId,
    message_thread_id: message.threadId,
    direct_messages_topic_id: message.directTopicId,
    reply_parameters: { message_id: message.messageId, allow_sending_without_reply: true },
  }
  let body: string | FormData
  if (document) {
    body = new FormData()
    body.set('caption', text.slice(0, 1024).toWellFormed())
    body.set('document', new Blob([document.bytes]), document.name)
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) body.set(key, JSON.stringify(value))
    }
  } else {
    body = JSON.stringify({ ...fields, text })
  }
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${document ? 'sendDocument' : 'sendMessage'}`, {
      method: 'POST',
      headers: document ? undefined : { 'Content-Type': 'application/json' },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(document ? 15_000 : 5_000),
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
