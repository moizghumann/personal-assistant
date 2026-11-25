import assert from 'node:assert/strict'
import test from 'node:test'
import app from '../src/app.js'

test('GET /test/ai forwards the prompt to Cloudflare and returns the workflow result', async (t) => {
  process.env.AGENT_WORKER_URL = 'https://agent.test'
  process.env.AGENT_WORKER_TOKEN = 'test-worker-token'
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string | URL, options: RequestInit) => {
    assert.equal(String(url), 'https://agent.test/test/ai')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-worker-token')
    const { prompt } = JSON.parse(String(options.body))
    return new Response(prompt || 'An answer about leap years.', {
      headers: { 'X-Workflow-Id': `run-${fetchMock.mock.callCount()}` },
    })
  })

  const custom = await app.request('/test/ai?prompt=Write%20a%20story')
  assert.equal(custom.status, 200)
  assert.equal(await custom.text(), 'Write a story')
  const repeated = await app.request('/test/ai?prompt=Write%20a%20story')
  assert.equal(await repeated.text(), 'Write a story')
  assert.ok(custom.headers.get('X-Workflow-Id'))
  assert.notEqual(custom.headers.get('X-Workflow-Id'), repeated.headers.get('X-Workflow-Id'))

  assert.equal(await (await app.request('/test/ai?prompt=Write%20a%20poem')).text(), 'Write a poem')
  assert.match(await (await app.request('/test/ai')).text(), /leap years/)
  assert.equal(fetchMock.mock.callCount(), 4)
})
