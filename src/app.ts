import { Hono } from 'hono'
import aiTest from './ai-check.js'
import telegram from './telegram.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Railway!')
})

app.get('/marco', (c) => {
  return c.text('polo')
})

app.route('/telegram', telegram)
app.route('/', aiTest)

export default app
