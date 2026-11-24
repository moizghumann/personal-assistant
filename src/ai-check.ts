import { neon } from '@neon/ai-sdk-provider'
import { generateText } from 'ai'
import { Hono } from 'hono'

export async function generateAnswer() {
  const signal = AbortSignal.timeout(12_000)
  try {
    const result = await generateText({
      model: neon('meta-llama-3-1-8b-instruct'),
      prompt: 'Earth takes about 365.24 days to orbit the Sun. Explain why most calendar years have 365 days and why we have leap years in two or three plain-text sentences.',
      maxOutputTokens: 256,
      maxRetries: 0,
      abortSignal: signal,
    })
    const text = result.text.trim()
    if (!text) throw new Error('The model returned no text')
    return text
  } catch (error) {
    signal.throwIfAborted()
    throw error
  }
}

const aiTest = new Hono()

let cachedTest: { expiresAt: number; answer: Promise<string> } | undefined

aiTest.get('/test/ai', async (c) => {
  c.header('Cache-Control', 'no-store')
  if (!process.env.NEON_AI_GATEWAY_BASE_URL || !process.env.NEON_AI_GATEWAY_TOKEN) {
    return c.text('Neon AI Gateway is not configured', 503)
  }

  const now = Date.now()
  if (!cachedTest || cachedTest.expiresAt <= now) {
    // shortcut: share one attempt per process per minute until this temporary route is removed.
    cachedTest = { expiresAt: now + 60_000, answer: generateAnswer() }
  }

  try {
    return c.text(await cachedTest.answer)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return c.text('AI test timed out', 504)
    }
    console.error('AI test generation failed')
    return c.text('AI test could not generate a response', 502)
  }
})

export default aiTest
