import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

export class HelloWorld extends WorkflowEntrypoint<Env, { name?: string }> {
  async run(event: WorkflowEvent<{ name?: string }>, step: WorkflowStep) {
    const name = event.payload?.name
    const recipient = typeof name === 'string' ? name : 'world'
    await step.sleep('wait-five-seconds', '5 seconds')
    return step.do('greet', async () => ({ message: `Hello, ${recipient}` }))
  }
}
