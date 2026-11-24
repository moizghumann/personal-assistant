import { idempotencyKeys, tasks, TriggerClient } from '@trigger.dev/sdk'
import { Hono } from 'hono'
import type { aiTestTask } from './trigger/ai-check.js'

const aiTest = new Hono()

aiTest.get('/test/ai', async (c) => {
  c.header('Cache-Control', 'no-store')
  if (!process.env.TRIGGER_SECRET_KEY) {
    return c.text('Trigger.dev is not configured', 503)
  }

  const timeout = AbortSignal.timeout(25_000)
  try {
    // shortcut: all visitors share one fixed-prompt result per minute, replace when removing the test route.
    const idempotencyKey = await idempotencyKeys.create('public-ai-test', { scope: 'global' })
    const handle = await tasks.trigger<typeof aiTestTask>('ai-test', {}, {
      idempotencyKey,
      idempotencyKeyTTL: '1m',
      ttl: '20s',
    }, { retry: { maxAttempts: 1 } })

    const client = new TriggerClient({ accessToken: handle.publicAccessToken })
    for await (const run of client.runs.subscribeToRun<typeof aiTestTask>(handle.id, {
      signal: AbortSignal.any([timeout, c.req.raw.signal]),
    })) {
      if (run.isSuccess && run.output?.text) return c.text(run.output.text)
      if (run.isCompleted) break
    }
  } catch {
    console.error('AI test task request failed')
  }

  if (timeout.aborted) return c.text('AI test timed out', 504)
  return c.text('AI test could not generate a response', 502)
})

export default aiTest
