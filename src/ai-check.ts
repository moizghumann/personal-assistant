import { neon } from '@neon/ai-sdk-provider'
import { serve } from '@upstash/workflow/hono'
import { generateText } from 'ai'
import { Hono } from 'hono'

const aiTest = new Hono()

async function generateAnswer(signal: AbortSignal = AbortSignal.timeout(12_000)) {
  try {
    const { text } = await generateText({
      model: neon('meta-llama-3-1-8b-instruct'),
      prompt: 'Explain why the sky looks blue in one short sentence.',
      maxOutputTokens: 64,
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

const workflow = serve(async (context) => {
  await context.run('generate-answer', async () => ({ text: await generateAnswer() }))
})

aiTest.post('/workflows/ai-test', async (c, next) => {
  const localDev = ['true', '1'].includes(process.env.QSTASH_DEV ?? '')
  if (localDev && (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_ID)) {
    return c.text('QStash development mode is unavailable in production', 503)
  }
  const { QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY } = process.env
  if (!localDev && !(QSTASH_TOKEN && QSTASH_CURRENT_SIGNING_KEY && QSTASH_NEXT_SIGNING_KEY)) {
    return c.text('Upstash Workflow is not configured', 503)
  }
  if (!c.req.header('upstash-signature')) return c.text('QStash signature required', 401)

  await next()
  if (c.res.status === 500) c.res = c.text('Workflow request failed', 500)
}, workflow)

export default aiTest
