import assert from 'node:assert/strict'
import test from 'node:test'
import app from '../src/app.ts'

test('Telegram webhook authenticates updates and sends generated text to the original chat', async (t) => {
  process.env.TELEGRAM_BOT_TOKEN = '123:fake-token'
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret'
  process.env.NEON_AI_GATEWAY_BASE_URL = 'https://gateway.test'
  process.env.NEON_AI_GATEWAY_TOKEN = 'fake-gateway-token'
  const gatewayUrl = 'https://gateway.test/v1/chat/completions'
  const telegramUrl = 'https://api.telegram.org/bot123:fake-token/sendMessage'
  const generatedReply = 'Hello! How can I help?'
  let gatewayFails = false
  let telegramFails = false
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === gatewayUrl) {
      if (gatewayFails) return Response.json({ error: { message: 'Unavailable' } }, { status: 503 })
      return Response.json({
        id: 'completion',
        model: 'meta-llama-3-1-8b-instruct',
        choices: [{ index: 0, message: { role: 'assistant', content: generatedReply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
      })
    }
    if (url === telegramUrl) {
      return Response.json({ ok: !telegramFails }, { status: telegramFails ? 429 : 200 })
    }
    throw new Error('Unexpected outbound request')
  })
  const post = (update, secret = 'test-secret') => app.request('/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify(update),
  })

  const textUpdate = {
    update_id: 1,
    message: { chat: { id: 42 }, message_id: 7, text: 'hello' },
  }
  assert.equal((await post(textUpdate, 'wrong-secret')).status, 401)
  assert.equal((await post({ update_id: 2, message: {} })).status, 400)
  assert.equal((await post({ update_id: 3 })).status, 204)
  assert.equal((await post({
    update_id: 4,
    message: { chat: { id: 42 }, message_id: 8, photo: [{ file_id: 'photo' }] },
  })).status, 204)
  assert.equal(fetchMock.mock.callCount(), 0)

  assert.equal((await post(textUpdate)).status, 204)
  const [generation, reply] = fetchMock.mock.calls
  assert.equal(generation.arguments[0], gatewayUrl)
  assert.equal(generation.arguments[1].method, 'POST')
  const input = JSON.parse(generation.arguments[1].body)
  assert.equal(input.model, 'meta-llama-3-1-8b-instruct')
  assert.equal(input.max_tokens, 256)
  assert.deepEqual(input.messages.at(-1), { role: 'user', content: 'hello' })
  assert.equal(reply.arguments[0], telegramUrl)
  assert.equal(reply.arguments[1].method, 'POST')
  assert.deepEqual(JSON.parse(reply.arguments[1].body), {
    chat_id: 42, text: generatedReply,
    reply_parameters: { message_id: 7, allow_sending_without_reply: true },
  })

  assert.equal((await post({
    update_id: 5,
    message: {
      chat: { id: -123 },
      message_id: 8,
      is_topic_message: true,
      message_thread_id: 5,
      text: 'hello from a topic',
    },
  })).status, 204)
  assert.deepEqual(JSON.parse(fetchMock.mock.calls.at(-1).arguments[1].body), {
    chat_id: -123, text: generatedReply, message_thread_id: 5,
    reply_parameters: { message_id: 8, allow_sending_without_reply: true },
  })

  gatewayFails = true
  const callsBeforeFailure = fetchMock.mock.callCount()
  assert.equal((await post(textUpdate)).status, 204)
  assert.equal(fetchMock.mock.callCount(), callsBeforeFailure + 2)
  assert.match(JSON.parse(fetchMock.mock.calls.at(-1).arguments[1].body).text, /try again/)

  gatewayFails = false
  telegramFails = true
  assert.equal((await post(textUpdate)).status, 502)
})
