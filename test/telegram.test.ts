import assert from 'node:assert/strict'
import test from 'node:test'
import app from '../src/app.js'
import { sendTelegramReply, sendTelegramTyping, TelegramRateLimitError } from '../src/telegram-api.js'

test('Hono verifies Telegram updates and replies directly through Neon and Telegram', async (t) => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret'
  process.env.TELEGRAM_BOT_TOKEN = 'fake-bot-token'
  process.env.NEON_AI_GATEWAY_BASE_URL = 'https://neon.test'
  process.env.NEON_AI_GATEWAY_TOKEN = 'fake-neon-token'
  let neonStatus = 200
  let telegramStatus = 200
  const fetchMock = t.mock.method(globalThis, 'fetch', async (destination: string | URL) => {
    const url = String(destination)
    if (url === 'https://neon.test/v1/chat/completions') {
      if (neonStatus !== 200) return Response.json({ error: { message: 'Unavailable' } }, { status: neonStatus })
      return Response.json({
        id: 'completion',
        model: 'meta-llama-3-1-8b-instruct',
        choices: [{ index: 0, message: { role: 'assistant', content: 'A generated reply.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
      })
    }
    assert.equal(url, 'https://api.telegram.org/botfake-bot-token/sendMessage')
    return Response.json({ ok: telegramStatus === 200, result: { message_id: 8 } }, { status: telegramStatus })
  })

  const post = (update: object, secret = 'test-secret') => app.request('/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify(update),
  })

  const update = { update_id: 1, message: { chat: { id: 42 }, message_id: 7, text: 'hello' } }
  assert.equal((await post(update, 'wrong-secret')).status, 401)
  assert.equal((await post({ update_id: 2, message: {} })).status, 400)
  assert.equal((await post({ update_id: 3 })).status, 204)
  assert.equal((await post({ update_id: 4, message: { chat: { id: 42 }, message_id: 8 } })).status, 204)
  assert.equal(fetchMock.mock.callCount(), 0)

  assert.equal((await post(update)).status, 204)
  const [generation, send] = fetchMock.mock.calls
  assert.deepEqual(JSON.parse(generation.arguments[1].body).messages.at(-1), { role: 'user', content: 'hello' })
  assert.deepEqual(JSON.parse(send.arguments[1].body), {
    chat_id: 42,
    text: 'A generated reply.',
    reply_parameters: { message_id: 7, allow_sending_without_reply: true },
  })

  const topicMessage = { ...update.message, is_topic_message: true, message_thread_id: 5 }
  assert.equal((await post({ ...update, message: topicMessage })).status, 204)
  assert.equal(JSON.parse(fetchMock.mock.calls.at(-1).arguments[1].body).message_thread_id, 5)

  neonStatus = 503
  assert.equal((await post(update)).status, 204)
  assert.match(JSON.parse(fetchMock.mock.calls.at(-1).arguments[1].body).text, /try again/)

  neonStatus = 200
  telegramStatus = 429
  assert.equal((await post(update)).status, 502)
})

test('The agent sends the reply to the original chat and thread', async (t) => {
  let telegramStatus = 200
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ok: telegramStatus === 200, result: { message_id: 8 } }, { status: telegramStatus }),
  )
  const message = { updateId: 1, chatId: -123, messageId: 7, threadId: 5, text: 'hello' }

  assert.equal(await sendTelegramReply('fake-token', message, 'Hello! How can I help?'), 8)
  const [destination, options] = fetchMock.mock.calls[0].arguments
  assert.equal(destination, 'https://api.telegram.org/botfake-token/sendMessage')
  assert.equal(options.redirect, 'manual')
  assert.deepEqual(JSON.parse(options.body), {
    chat_id: -123,
    text: 'Hello! How can I help?',
    message_thread_id: 5,
    reply_parameters: { message_id: 7, allow_sending_without_reply: true },
  })
  telegramStatus = 429
  await assert.rejects(sendTelegramReply('fake-token', message, 'Hello'), /HTTP 429/)
  telegramStatus = 302
  await assert.rejects(sendTelegramReply('fake-token', message, 'Hello'), /HTTP 302/)
})

test('Telegram replies distinguish a confirmed flood limit from an ambiguous failure', async (t) => {
  const message = { updateId: 1, chatId: 42, messageId: 7, text: 'hello' }
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ok: false, error_code: 429, parameters: { retry_after: 3 } }, { status: 429 }),
  )
  await assert.rejects(sendTelegramReply('fake-token', message, 'Hello'),
    (error) => error instanceof TelegramRateLimitError && error.retryAfterSeconds === 3)

  fetchMock.mock.mockImplementation(async () => Response.json({ error: 'Gateway timeout' }, { status: 504 }))
  await assert.rejects(sendTelegramReply('fake-token', message, 'Hello'),
    (error) => error instanceof Error && !(error instanceof TelegramRateLimitError) && /HTTP 504/.test(error.message))
})

test('Typing targets the original chat and forum topic', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Mock network failure') })
  const message = { updateId: 1, chatId: -123, messageId: 7, threadId: 5, text: 'hello' }
  await sendTelegramTyping('fake-token', message)

  const [destination, options] = fetchMock.mock.calls[0].arguments
  assert.equal(destination, 'https://api.telegram.org/botfake-token/sendChatAction')
  assert.deepEqual(JSON.parse(options.body), { chat_id: -123, message_thread_id: 5, action: 'typing' })
  await sendTelegramTyping('fake-token', { ...message, directTopicId: 11 })
  assert.equal(fetchMock.mock.callCount(), 1)
})
