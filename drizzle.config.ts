import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL_UNPOOLED
if (!databaseUrl) throw new Error('Set DATABASE_URL_UNPOOLED before pushing the schema.')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  dbCredentials: { url: databaseUrl },
})
