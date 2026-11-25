import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { generateTelegramAnswer } from '../../ai.js'
import { isTelegramReply, sendTelegramReply } from '../../telegram-api.js'
import type { TelegramReply } from '../../telegram-api.js'

export class TelegramReplyWorkflow extends WorkflowEntrypoint<Env, TelegramReply> {
  async run(event: WorkflowEvent<TelegramReply>, step: WorkflowStep) {
    const message = event.payload
    if (!isTelegramReply(message)) throw new Error('Invalid Telegram reply payload')

    const reply = await step.do('generate-reply', () => generateTelegramAnswer(this.env, message.text))

    // A timed-out send may already have reached Telegram.
    await step.do('send-reply', { retries: { limit: 0, delay: '1 second' } }, () =>
      sendTelegramReply(this.env.TELEGRAM_BOT_TOKEN, message, reply),
    )
    return { sent: true }
  }
}
