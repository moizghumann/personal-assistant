```
npm install
npm run dev
```

```
open http://localhost:3000
```

`npm run build` type-checks `src` without generating files. `npm start` runs
`src/index.ts` directly with `tsx` and uses the server environment.

## Telegram agent and Cloudflare Workflows

The Railway Hono app verifies Telegram webhooks, generates replies through
Neon AI Gateway, and sends the replies back to Telegram. The Cloudflare Worker
can run its workflows independently.

| Environment | Variables |
| --- | --- |
| Hono on Railway or local `src/.env` | `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN` |
| Cloudflare Worker or local `src/worker/.dev.vars` | `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN`, `TELEGRAM_BOT_TOKEN`, `AGENT_WORKER_TOKEN` |

The Hono app starts at `src/index.ts` and the Worker starts at
`src/worker/agent-worker.ts`. Workflow definitions live in `src/worker/workflows`.

Use a different `AGENT_WORKER_TOKEN` for local and production Worker HTTP
requests. Start Hono with `npm run dev` or the Worker with `npm run dev:worker`.

Run `npm test` for the router and mocked Telegram webhook and `npm run build:worker` to
generate Worker binding types and type-check the workflows.

Deploy each app independently. The Telegram webhook URL and
`TELEGRAM_WEBHOOK_SECRET` belong to the Hono app on Railway.
