import { AIChatAgent } from '@cloudflare/ai-chat'
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { generateTelegramAnswer, neonRateLimit } from '../ai.js'
import { sendTelegramReply, TelegramRateLimitError, TelegramRejectedError } from '../telegram-api.js'
import type { TelegramReply } from '../telegram-api.js'

export type TelegramWorkflowInput = TelegramReply & { previousWorkflowId?: string }

type Intake = {
  latest?: string
  pending?: TelegramWorkflowInput
}

export function telegramConversation(message: TelegramReply) {
  if (message.directTopicId !== undefined) return `${message.chatId}:direct:${message.directTopicId}`
  if (message.threadId !== undefined) return `${message.chatId}:thread:${message.threadId}`
  return String(message.chatId)
}

export class TelegramChat extends AIChatAgent<Env> {
  maxPersistedMessages = 80
  private intake = Promise.resolve()

  async acceptUpdate(message: TelegramReply): Promise<string> {
    const accepted = this.intake.then(async () => {
      const storage = this.ctx.storage
      const id = `telegram-${message.updateId}`
      if (await storage.get(`accepted:${id}`)) return id
      const state = await storage.get<Intake>('telegram-intake') ?? {}
      const latest = state.pending ? await this.startPending(state.pending) : state.latest
      if (latest === id) return id

      // Save the handoff first so a retry can recover if the workflow starts before the receipt is stored.
      const pending = latest ? { ...message, previousWorkflowId: latest } : message
      await storage.put<Intake>('telegram-intake', { latest, pending })
      return this.startPending(pending)
    })
    this.intake = accepted.then(() => {}, () => {})
    return accepted
  }

  private async startPending(message: TelegramWorkflowInput) {
    const id = `telegram-${message.updateId}`
    try {
      await this.env.TELEGRAM_REPLY.create({ id, params: message })
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('(instance.already_exists)')) throw error
    }
    await this.ctx.storage.put({ 'telegram-intake': { latest: id }, [`accepted:${id}`]: 'accepted' })
    return id
  }

  async finishUpdate(id: string) {
    const finished = this.intake.then(async () => {
      const state = await this.ctx.storage.get<Intake>('telegram-intake')
      if (state?.latest === id && !state.pending) await this.ctx.storage.delete('telegram-intake')
    })
    this.intake = finished.then(() => {}, () => {})
    await finished
  }

  async replyToUpdate(updateId: number, text: string): Promise<string> {
    await this.intake
    if (!await this.waitUntilStable()) throw new Error('Telegram conversation is still busy')

    const id = `telegram-message-${updateId}`
    const receipt = `accepted:telegram-${updateId}`
    const previousReply = this.messages.find((message) => message.id === `${id}-reply`)
    const savedText = previousReply?.parts.find((part) => part.type === 'text')?.text
    if (savedText) {
      this.ctx.storage.kv.put(receipt, 'answered')
      return savedText
    }
    const state = this.ctx.storage.kv.get(receipt)
    if (state === 'generating') throw new Error('Neon AI Gateway generation outcome unknown')
    if (state === 'answered') {
      throw new Error('Telegram reply is outside retained history')
    }

    const result = await this.saveMessages((history) => {
      const existing = history.findIndex((message) => message.id === id)
      if (existing >= 0) {
        if (existing !== history.length - 1) throw new Error('Telegram turn is no longer at the end of the conversation')
        return [...history]
      }
      return [...history, { id, role: 'user', parts: [{ type: 'text', text }] }]
    })
    if (result.status !== 'completed') throw new Error('Telegram agent turn failed')

    const reply = this.messages.find((message) => message.id === `${id}-reply`)
    const replyText = reply?.parts.find((part) => part.type === 'text')?.text
    if (!replyText) throw new Error('Telegram agent returned no reply')
    this.ctx.storage.kv.put(receipt, 'answered')
    return replyText
  }

  async onChatMessage() {
    const last = this.messages.at(-1)
    if (last?.role !== 'user' || !last.id.startsWith('telegram-message-')) {
      throw new Error('Telegram agent has no user message')
    }
    const history = await convertToModelMessages(this.messages.slice(-21))
    const receipt = `accepted:telegram-${last.id.slice('telegram-message-'.length)}`
    const storage = this.ctx.storage.kv
    const state = storage.get(receipt)
    if (state === 'generating') throw new Error('Neon AI Gateway generation outcome unknown')
    if (state === 'answered') throw new Error('Telegram update has already been answered')
    // Record the attempt before calling Neon so a crash cannot trigger a second model call.
    storage.put(receipt, 'generating')
    const text = await generateTelegramAnswer(this.env, history).catch((error: unknown) => {
      if (error instanceof Error && error.message === neonRateLimit) storage.put(receipt, 'accepted')
      throw error
    })

    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute({ writer }) {
          writer.write({ type: 'start', messageId: `${last.id}-reply` })
          writer.write({ type: 'text-start', id: 'reply' })
          writer.write({ type: 'text-delta', id: 'reply', delta: text })
          writer.write({ type: 'text-end', id: 'reply' })
          writer.write({ type: 'finish', finishReason: 'stop' })
        },
      }),
    })
  }

  async deliverUpdate(message: TelegramReply, text: string): Promise<{ messageId: number } | { retryAfter: number }> {
    const storage = this.ctx.storage.kv
    const key = `telegram-delivery:${message.updateId}`
    const receipt = storage.get<number | 'unknown' | 'rejected'>(key)
    if (typeof receipt === 'number') return { messageId: receipt }
    if (receipt === 'unknown') throw new Error('Telegram delivery unknown (an earlier attempt was not acknowledged)')
    if (receipt === 'rejected') throw new Error('Telegram rejected an earlier delivery attempt')

    // shortcut: a lost acknowledgement leaves delivery unknown, revisit if Telegram adds idempotent sends.
    storage.put(key, 'unknown')
    try {
      const messageId = await sendTelegramReply(this.env.TELEGRAM_BOT_TOKEN, message, text)
      storage.put(key, messageId)
      return { messageId }
    } catch (error) {
      if (error instanceof TelegramRateLimitError) {
        storage.delete(key)
        return { retryAfter: error.retryAfterSeconds }
      }
      if (error instanceof TelegramRejectedError) storage.put(key, 'rejected')
      throw error
    }
  }
}
