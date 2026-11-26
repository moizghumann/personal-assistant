import { sql } from 'drizzle-orm'
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const channelIdentifiers = pgTable('channel_identifiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  platform: text('platform', { enum: ['telegram'] }).notNull(),
  externalUserId: text('external_user_id').notNull(),
  clerkUserId: text('clerk_user_id').notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('channel_identifiers_platform_check', sql`${table.platform} = 'telegram'`),
  uniqueIndex('channel_identifiers_platform_external_user_idx').on(table.platform, table.externalUserId),
])
