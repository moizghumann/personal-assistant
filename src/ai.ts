import { createNeon } from '@neon/ai-sdk-provider'
import { generateText } from 'ai'

type NeonEnv = {
  NEON_AI_GATEWAY_BASE_URL: string
  NEON_AI_GATEWAY_TOKEN: string
}

async function generateAnswer(env: NeonEnv, prompt: string, instructions?: string) {
  const signal = AbortSignal.timeout(12_000)
  const neon = createNeon({ baseURL: env.NEON_AI_GATEWAY_BASE_URL, apiKey: env.NEON_AI_GATEWAY_TOKEN })

  try {
    const { text } = await generateText({
      model: neon('meta-llama-3-1-8b-instruct'),
      instructions,
      prompt,
      maxOutputTokens: 256,
      maxRetries: 0,
      abortSignal: signal,
    })
    const answer = text.trim()
    if (!answer) throw new Error('The model returned no text')
    return answer
  } catch (error) {
    signal.throwIfAborted()
    throw error
  }
}

export function generateTestAnswer(env: NeonEnv) {
  return generateAnswer(env, 'Earth takes about 365.24 days to orbit the Sun. Explain why most calendar years have 365 days and why we have leap years in two or three plain-text sentences.')
}

export async function generateTelegramAnswer(env: NeonEnv, prompt: string) {
  try {
    const text = await generateAnswer(env, prompt, 'Reply concisely, in a non robotic and humane way in plain text.')
    return text.slice(0, 4096).toWellFormed()
  } catch {
    console.error('Neon AI Gateway generation failed')
    return 'I couldn’t generate a reply right now. Please try again.'
  }
}

