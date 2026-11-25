import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { getAgentByName } from 'agents'
import { isTelegramReply, sendTelegramReply } from '../../telegram-api.js'
import { telegramConversation } from '../telegram-chat.js'
import type { TelegramWorkflowInput } from '../telegram-chat.js'

export class TelegramReplyWorkflow extends WorkflowEntrypoint<Env, TelegramWorkflowInput> {
  async run(event: WorkflowEvent<TelegramWorkflowInput>, step: WorkflowStep) {
    const message = event.payload
    if (!isTelegramReply(message)) throw new Error('Invalid Telegram reply payload')

    const previousId = message.previousWorkflowId
    if (previousId) {
      await step.do('wait-for-previous-reply', { retries: { limit: 1_000, delay: '5 seconds' } }, async () => {
        const previous = await this.env.TELEGRAM_REPLY.get(previousId)
        const { status } = await previous.status()
        if (status !== 'complete' && status !== 'errored' && status !== 'terminated') {
          throw new Error('Previous Telegram reply is still in progress')
        }
      })
    }

    const name = telegramConversation(message)
    try {
      const reply = await step.do('generate-reply', async () => {
        const agent = await getAgentByName(this.env.TELEGRAM_CHAT, name)
        return agent.replyToUpdate(message.updateId, message.text)
      })

      // A timed-out send may already have reached Telegram.
      await step.do('send-reply', { retries: { limit: 0, delay: '1 second' } }, () =>
        sendTelegramReply(this.env.TELEGRAM_BOT_TOKEN, message, reply),
      )
      return { sent: true }
    } finally {
      await step.do('release-conversation', async () => {
        const agent = await getAgentByName(this.env.TELEGRAM_CHAT, name)
        await agent.finishUpdate(event.instanceId)
      })
    }
  }
}
