import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { getAgentByName } from 'agents'
import { neonRateLimit, telegramGenerationFailure } from '../../ai.js'
import { isTelegramReply, sendTelegramTyping } from '../../telegram-api.js'
import type { TelegramReply } from '../../telegram-api.js'
import { telegramConversation } from '../telegram-chat.js'
import type { TelegramWorkflowInput } from '../telegram-chat.js'

export class TelegramReplyWorkflow extends WorkflowEntrypoint<Env, TelegramWorkflowInput> {
  async run(event: WorkflowEvent<TelegramWorkflowInput>, step: WorkflowStep) {
    const message = event.payload
    if (!isTelegramReply(message)) throw new Error('Invalid Telegram reply payload')

    const previousId = message.previousWorkflowId
    if (previousId) {
      await step.do('wait-for-previous-reply', { timeout: '30 seconds', retries: { limit: 1_000, delay: '5 seconds' } }, async () => {
        const previous = await this.env.TELEGRAM_REPLY.get(previousId)
        const { status } = await previous.status()
        if (['complete', 'errored', 'terminated'].includes(status)) return

        using events = await previous.subscribe({ filter: ['workflow_completed', 'workflow_errored', 'workflow_terminated'] })
        for (;;) {
          const { done } = await events.next()
          if (['complete', 'errored', 'terminated'].includes((await previous.status()).status)) return
          if (done) throw new Error('Previous Telegram reply is still in progress')
        }
      })
    }

    const name = telegramConversation(message)
    try {
      let reply: string
      try {
        reply = await step.do('generate-reply', { timeout: '3 minutes', retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' } }, async () => {
          const token = this.env.TELEGRAM_BOT_TOKEN
          let typing = sendTelegramTyping(token, message)
          const refresh = setInterval(() => { typing = sendTelegramTyping(token, message) }, 4_000)
          try {
            const agent = await getAgentByName(this.env.TELEGRAM_CHAT, name)
            return await agent.replyToUpdate(message)
          } catch (error) {
            if (error instanceof Error && error.message === neonRateLimit) throw error
            throw new NonRetryableError(error instanceof Error ? error.message : 'Telegram generation failed')
          } finally {
            clearInterval(refresh)
            await typing
          }
        })
      } catch (error) {
        await this.deliver(step, 'send-generation-failure', message, telegramGenerationFailure)
        throw error
      }

      const messageId = await this.deliver(step, 'send-reply', message, reply)
      return { sent: true, messageId }
    } finally {
      await step.do('release-conversation', async () => {
        const agent = await getAgentByName(this.env.TELEGRAM_CHAT, name)
        await agent.finishUpdate(event.instanceId)
      })
    }
  }

  private async deliver(step: WorkflowStep, name: string, message: TelegramReply, text: string) {
    for (let attempt = 1; ; attempt++) {
      const stepName = attempt === 1 ? name : `${name}-${attempt}`
      const delivery = await step.do(stepName, { retries: { limit: 0, delay: '1 second' } }, async () => {
        const agent = await getAgentByName(this.env.TELEGRAM_CHAT, telegramConversation(message))
        using result = await agent.deliverUpdate(message, text, name === 'send-reply')
        if ('messageId' in result) return { messageId: result.messageId }
        if (attempt === 3) throw new Error('Telegram still rate limited after three attempts')
        return { retryAfter: result.retryAfter }
      })
      if ('messageId' in delivery) return delivery.messageId
      await step.sleep(`${stepName}-rate-limit`, `${delivery.retryAfter} seconds`)
    }
  }
}
