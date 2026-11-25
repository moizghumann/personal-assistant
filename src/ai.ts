import { createNeon } from '@neon/ai-sdk-provider'
import { APICallError, generateText } from 'ai'
import type { ModelMessage } from 'ai'

type NeonEnv = {
  NEON_AI_GATEWAY_BASE_URL: string
  NEON_AI_GATEWAY_TOKEN: string
}

async function generateAnswer(env: NeonEnv, input: string | ModelMessage[], instructions?: string) {
  const signal = AbortSignal.timeout(12_000)
  const neon = createNeon({ baseURL: env.NEON_AI_GATEWAY_BASE_URL, apiKey: env.NEON_AI_GATEWAY_TOKEN })

  try {
    const { text } = await generateText({
      model: neon('meta-llama-3-1-8b-instruct'),
      instructions,
      ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
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

export function generateTestAnswer(
  env: NeonEnv,
  prompt = 'Earth takes about 365.24 days to orbit the Sun. Explain why most calendar years have 365 days and why we have leap years in two or three plain-text sentences.',
) {
  return generateAnswer(env, prompt)
}

export const telegramGenerationFailure = 'I couldn’t generate a reply right now. Please try again.'
export const neonRateLimit = 'Neon AI Gateway generation failed (HTTP 429)'

export async function generateTelegramAnswer(env: NeonEnv, prompt: string | ModelMessage[]) {
  try {
    const text = await generateAnswer(env, prompt, 'Reply concisely, in a non robotic and humane way in plain text.')
    return text.slice(0, 4096).toWellFormed()
  } catch (error) {
    // Provider errors can include the Telegram transcript in their request body.
    if (APICallError.isInstance(error) && error.statusCode) {
      if (error.statusCode === 429) throw new Error(neonRateLimit)
      throw new Error(`Neon AI Gateway generation failed (HTTP ${error.statusCode})`)
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('Neon AI Gateway generation timed out')
    }
    throw new Error('Neon AI Gateway generation failed')
  }
}

