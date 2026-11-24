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
