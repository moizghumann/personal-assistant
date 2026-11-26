import assert from 'node:assert/strict'
import test from 'node:test'
import app from '../src/app.js'

test('Hono serves the root and leaves demo endpoints unregistered', async () => {
  assert.equal((await app.request('/')).status, 200)
  assert.equal((await app.request('/marco')).status, 404)
  assert.equal((await app.request('/test/ai')).status, 404)
})
