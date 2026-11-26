import { Hono } from 'hono'
import { receiveTelegramWebhook } from './telegram.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Railway!')
})

app.post('/telegram/webhook', receiveTelegramWebhook)

export default app
