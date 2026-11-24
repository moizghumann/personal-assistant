```
npm install
npm run dev
```

```
open http://localhost:3000
```

## Telegram AI bot

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEON_AI_GATEWAY_BASE_URL`,
and `NEON_AI_GATEWAY_TOKEN` in the server environment. `npm run dev` loads
them from `src/.env` locally.
After deploying, call Telegram's [`setWebhook`](https://core.telegram.org/bots/api#setwebhook)
with your public HTTPS URL ending in `/telegram/webhook`, the same secret as
`secret_token`, and `allowed_updates` set to `["message"]`.

The bot replies to text messages using Llama 3.1 8B Instruct through Neon AI
Gateway. Run `npm test` to check the webhook with mocked AI Gateway and
Telegram APIs.

## AI workflow smoke test

`GET /test/ai` returns a short AI-generated answer. To test background execution,
start an Upstash Workflow run targeting `/workflows/ai-test` and check the
`generate-answer` step output in the Upstash console.

On Railway, set `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and
`QSTASH_NEXT_SIGNING_KEY` for the same Upstash region. Set `UPSTASH_WORKFLOW_URL`
to the app's public HTTPS base URL. The workflow uses the app's Neon credentials.

For local testing, set `QSTASH_DEV=true` in `src/.env` and run `npm run dev`.
Open the local QStash console URL printed in the terminal and start a workflow
against `http://localhost:3000/workflows/ai-test`.
