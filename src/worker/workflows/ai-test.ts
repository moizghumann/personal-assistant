import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { generateTestAnswer } from '../../ai.js'

export class AiTest extends WorkflowEntrypoint<Env> {
  async run(_event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const text = await step.do('generate-answer', () => generateTestAnswer(this.env))
    return { text }
  }
}
