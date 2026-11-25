## Railway environment sync

Always exclude `TRIGGER_SECRET_KEY` when syncing local environment variables to Railway, including bulk syncs. The local key is for Trigger.dev development. Leave Railway's existing `TRIGGER_SECRET_KEY` untouched.

Exclude `QSTASH_DEV` and local QStash credentials from Railway syncs.

Exclude local `AGENT_WORKER_URL` and `AGENT_WORKER_TOKEN` from Railway syncs. Configure the production Worker URL and shared token separately.
