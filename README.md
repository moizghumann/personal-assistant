```
npm install
npm run dev
```

```
open http://localhost:3000
```

`npm run build` type-checks `src` without generating files. `npm start` runs
`src/index.ts` directly with `tsx` and uses the server environment.

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

## Upstash Workflow smoke tests

`GET /test/ai` returns a short AI-generated answer. Start these background runs
and check their step output in the Upstash console:

- `POST /workflows/hello-world` waits five seconds and returns a greeting in the
  `greet` step. Send `{}` for the default greeting or `{"name":"Moiz"}` for a name.
- `POST /workflows/ai-test` returns generated text in the `generate-answer` step.

On Railway, set `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and
`QSTASH_NEXT_SIGNING_KEY` for the same Upstash region. Set `UPSTASH_WORKFLOW_URL`
to the app's public HTTPS base URL. The workflow uses the app's Neon credentials.

For local testing, set `QSTASH_DEV=true` in `src/.env` and run `npm run dev`.
Open the local QStash console URL printed in the terminal and start a workflow
against either path on `http://localhost:3000`.
