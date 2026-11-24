import { Hono } from 'hono'
import aiTest from './ai-check.js'
import { requireQStashCallback } from './qstash.js'
import telegram from './telegram.js'
import { aiTestWorkflow } from './workflows/ai-test-workflow.js'
import { helloWorldWorkflow } from './workflows/hello-world.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Railway!')
})

app.get('/marco', (c) => {
  return c.text('polo')
})

app.route('/telegram', telegram)
app.route('/', aiTest)
app.post('/workflows/hello-world', requireQStashCallback, helloWorldWorkflow)
app.post('/workflows/ai-test', requireQStashCallback, aiTestWorkflow)

export default app
