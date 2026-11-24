import { serve } from '@upstash/workflow/hono'

export const helloWorldWorkflow = serve<{ name?: string }>(async (context) => {
  const name = context.requestPayload?.name
  const recipient = typeof name === 'string' ? name : 'world'

  await context.sleep('wait-five-seconds', '5s')
  await context.run('greet', () => ({ message: `Hello, ${recipient}` }))
})
