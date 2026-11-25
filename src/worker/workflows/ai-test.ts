import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { generateTestAnswer } from '../../ai.js'

export class AiTest extends WorkflowEntrypoint<Env, { prompt?: string }> {
  async run(event: WorkflowEvent<{ prompt?: string }>, step: WorkflowStep) {
    const prompt = typeof event.payload?.prompt === 'string' ? event.payload.prompt.trim() : ''
    const text = await step.do('generate-answer', { retries: { limit: 0, delay: '1 second' } }, () =>
      generateTestAnswer(this.env, prompt || undefined),
    )
    return { text }
  }
}
