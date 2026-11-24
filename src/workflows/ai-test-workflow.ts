import { serve } from '@upstash/workflow/hono'
import { generateAnswer } from '../ai-check.js'

export const aiTestWorkflow = serve(async (context) => {
  await context.run('generate-answer', async () => {
    const text = await generateAnswer()
    return { text }
  })
})
