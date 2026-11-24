import { createMiddleware } from 'hono/factory'

export const requireQStashCallback = createMiddleware(async (c, next) => {
  const env = process.env
  const developmentMode = env.QSTASH_DEV === 'true' || env.QSTASH_DEV === '1'
  const deployed = env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT_ID)
  const hasCredentials = env.QSTASH_TOKEN && env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY

  if (developmentMode && deployed) {
    return c.text('QStash development mode is unavailable in production', 503)
  }
  if (!developmentMode && !hasCredentials) {
    return c.text('Upstash Workflow is not configured', 503)
  }
  if (!c.req.header('upstash-signature')) {
    return c.text('QStash signature required', 401)
  }

  // The workflow adapter verifies the signature and logs failures.
  await next()
  if (c.res.status === 500) c.res = c.text('Workflow request failed', 500)
})
