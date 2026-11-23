import assert from 'node:assert/strict'
import test from 'node:test'
import app from '../src/app.ts'

test('Telegram webhook authenticates updates and copies text and media by ID', async (t) => {
  process.env.TELEGRAM_BOT_TOKEN = '123:fake-token'
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret'
  const copy = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ok: true, result: [{ message_id: 100 }] }),
  )
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
  assert.equal(copy.mock.callCount(), 0)

  assert.equal((await post(textUpdate)).status, 204)
  assert.equal((await post({
    update_id: 4,
    message: {
      chat: { id: -123 },
      message_id: 8,
      is_topic_message: true,
      message_thread_id: 5,
      photo: [{ file_id: 'photo' }],
    },
  })).status, 204)
  assert.equal(copy.mock.callCount(), 2)
  for (const { arguments: [url, options] } of copy.mock.calls) {
    assert.equal(url, 'https://api.telegram.org/bot123:fake-token/copyMessages')
    assert.equal(options.method, 'POST')
  }
  assert.deepEqual(JSON.parse(copy.mock.calls[0].arguments[1].body), {
    chat_id: 42, from_chat_id: 42, message_ids: [7],
  })
  assert.deepEqual(JSON.parse(copy.mock.calls[1].arguments[1].body), {
    chat_id: -123, from_chat_id: -123, message_ids: [8], message_thread_id: 5,
  })

  copy.mock.mockImplementation(async () => Response.json({ ok: false }, { status: 429 }))
  assert.equal((await post(textUpdate)).status, 502)
})
