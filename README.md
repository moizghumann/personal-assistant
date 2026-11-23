```
npm install
npm run dev
```

```
open http://localhost:3000
```

## Telegram echo bot

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in the server environment.
After deploying, call Telegram's [`setWebhook`](https://core.telegram.org/bots/api#setwebhook)
with your public HTTPS URL ending in `/telegram/webhook`, the same secret as
`secret_token`, and `allowed_updates` set to `["message"]`.

The bot copies each supported incoming message back to its chat. Run `npm test`
to check the webhook with a mocked Telegram API.
