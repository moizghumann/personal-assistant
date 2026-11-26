import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { channelIdentifiers } from './schema.js'

export function createDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema: { channelIdentifiers } })
}
