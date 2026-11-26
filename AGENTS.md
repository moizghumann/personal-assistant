## Railway environment sync

Always exclude `TRIGGER_SECRET_KEY` when syncing local environment variables to Railway, including bulk syncs. The local key is for Trigger.dev development. Leave Railway's existing `TRIGGER_SECRET_KEY` untouched.

Exclude `QSTASH_DEV` and local QStash credentials from Railway syncs.

Always exclude `AGENT_WORKER_TOKEN` when syncing environment variables with the Railway skill, including bulk syncs. Leave Railway's existing token untouched during a sync. Set or rotate it only in a separate, explicitly requested operation using the production Cloudflare Worker's token.

Exclude local and dev `AGENT_WORKER_URL` values from Railway syncs. Configure the production Worker URL separately.

## Database schema changes

Use `npm run db:push` to apply Drizzle schema changes. Keep `src/schema.ts` as the source of truth and avoid generating or running migration files. Use Neon’s direct `DATABASE_URL_UNPOOLED` connection for pushes.
