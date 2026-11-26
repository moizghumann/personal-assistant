import { createHash, timingSafeEqual } from 'node:crypto'
import { getAgentByName } from 'agents'
import { isTelegramReply, parseTelegramUpdate } from '../telegram-api.js'
import type { TelegramReply } from '../telegram-api.js'
import { telegramConversation } from './telegram-chat.js'

export { TelegramChat } from './telegram-chat.js'
export { TelegramReplyWorkflow } from './workflows/telegram-reply.js'

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname === '/telegram/webhook' && request.method === 'POST') {
      if (!env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Telegram webhook is unavailable', { status: 503 })
      }
      if (!matchesSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response('Unauthorized', { status: 401 })
      }
      const message = parseTelegramUpdate(await request.json().catch(() => null), true)
      if (typeof message === 'string') return new Response(message, { status: 400 })
      if (!message) return new Response(null, { status: 204 })
      return startTelegramReply(env, message)
    }

    if (pathname === '/telegram' && request.method === 'POST') {
      if (!env.AGENT_WORKER_TOKEN || !matchesSecret(request.headers.get('Authorization'), 'Bearer ' + env.AGENT_WORKER_TOKEN)) {
        return new Response('Unauthorized', { status: 401 })
      }
      const message: unknown = await request.json().catch(() => null)
      if (!isTelegramReply(message)) return new Response('Invalid Telegram reply payload', { status: 400 })
      return startTelegramReply(env, message)
    }

    return new Response('404 Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>

function matchesSecret(received: string | null, expected: string) {
  return received !== null && timingSafeEqual(
    createHash('sha256').update(received).digest(),
    createHash('sha256').update(expected).digest(),
  )
}

async function startTelegramReply(env: Env, message: TelegramReply) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.NEON_AI_GATEWAY_BASE_URL || !env.NEON_AI_GATEWAY_TOKEN) {
    return new Response('Telegram agent is unavailable', { status: 503 })
  }
  try {
    const agent = await getAgentByName(env.TELEGRAM_CHAT, telegramConversation(message))
    const id = await agent.acceptUpdate(message)
    return new Response(null, { status: 202, headers: { 'X-Workflow-Id': id } })
  } catch {
    console.error('Telegram workflow could not be started')
    return new Response('Telegram workflow unavailable', { status: 503 })
  }
}
