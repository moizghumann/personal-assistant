import { neon } from '@neon/ai-sdk-provider'
import { task } from '@trigger.dev/sdk'
import { generateText } from 'ai'

export const aiTestTask = task({
  id: 'ai-test',
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async (_payload: Record<string, never>, { signal }) => {
    const { text } = await generateText({
      model: neon('meta-llama-3-1-8b-instruct'),
      prompt: 'Explain why the sky looks blue in one short sentence.',
      maxOutputTokens: 64,
      maxRetries: 0,
      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    })
    const answer = text.trim()
    if (!answer) throw new Error('The model returned no text')
    return { text: answer }
  },
})
