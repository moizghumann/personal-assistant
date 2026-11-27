# Personal Assistant

A Telegram assistant built around a practical delivery problem: how do you accept updates quickly, keep replies in order, and handle a send whose outcome is uncertain?

The repository contains two independent entry points. The Cloudflare Worker handles background replies. The Hono server, configured for Railway, offers a simpler synchronous webhook path.

## How replies move through the Worker

1. [Worker](src/worker/agent-worker.ts) verifies the Telegram webhook, parses the update, and hands it to the conversation’s Durable Object. It returns HTTP 202 after acceptance.
2. [Conversation agent](src/worker/telegram-chat.ts) records the handoff and uses the Telegram update ID for the workflow ID. Each reply can wait for the previous workflow in the same conversation.
3. [Reply workflow](src/worker/workflows/telegram-reply.ts) separates generation and delivery. Generation goes through the Vercel AI SDK and Neon AI Gateway. The workflow retries gateway rate limits and waits when Telegram returns a retry interval.
4. [Delivery](src/worker/telegram-chat.ts) records the returned Telegram message ID. If an earlier send was left unacknowledged, delivery is treated as unknown and the agent avoids resending automatically. This trades a possible missed reply for a lower risk of duplicates.

The Worker also has [attachment tooling](src/worker/telegram-computer.ts) for working with files in a Daytona sandbox.

## Run locally

Use Node.js 22 or later.

```sh
npm ci
npm test
npm run dev
```

The Hono server starts at `http://localhost:3000`. To exercise its Telegram path, set `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `NEON_AI_GATEWAY_BASE_URL`, and `NEON_AI_GATEWAY_TOKEN` in `src/.env`.

For the Worker, put local secrets in `src/worker/.dev.vars` and run `npm run dev:worker`. See [the Wrangler configuration](src/worker/wrangler.jsonc) for bindings and secret names. Use separate secrets for development and deployment.

`npm run build` checks the Hono code. `npm run build:worker` generates binding types and checks the Worker. `npm test` covers routing and the mocked Hono webhook.
