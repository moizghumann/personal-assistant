import { tool } from 'ai'
import Firecrawl, { SdkError } from 'firecrawl'
import type { DiscoveredTool } from 'firecrawl'
import { z } from 'zod'

const instructions = `Reply concisely in plain text. Infer when to look up information from what the user wants, even when they never name a tool. For greetings, writing, stable facts, or conversation recall, answer directly. For current facts or claims about a particular source, use a lookup before answering.

Choose the tool by the evidence needed:
- Start structured lookups with findDataSource when that tool is available. "How much is the cheapest ticket including fees?", "What did this company make last quarter?", and "Which jobs actually went live this week?" call for records, so use findDataSource first. Other records include open tables and class spots, flights and hotels, campsite and streaming availability, product prices, housing listings, reviews, sports projections, market data, public records, company research, ads, creator metrics, and model benchmarks.
- After discovery, call queryDataSource with the returned ID and documented inputs. Pick a provider that covers the location, date, and fields. Discovery results describe capabilities. The subsequent lookup returns records. If discovery is unavailable, no provider fits, the call fails, or the records are missing, use webSearch and readPage as needed.
- Use readPage when the user asks about a specific public URL, or to verify details missing from a search result.
- Use webSearch for open-ended discovery such as upcoming comedy shows in a city, recent announcements, or a current software release. Prefer official or primary sources and event-specific pages.

Use the user's constraints when searching and deciding what qualifies:
- Resolve relative dates in the requested location's time zone, using the supplied Pakistan time for places in Pakistan. Carry the location, date, party size, budget, and other filters into follow-ups like "more options". Exclude previous suggestions. Ask for a missing detail only when it is needed for a useful lookup.
- "Find us a table tonight" means check actual slots for the date, time window, and party size. Confirm a requested rating threshold with a link specific to each venue. If you cannot verify openings, say so up front and list only rating-verified alternatives under "Options to contact". A phone number or booking homepage is insufficient evidence for an open slot.
- For events, require a future date with a year, using a specific event listing. For deals, compare the same variant or dates and include fees when known. For new jobs, use the original posting date. For prices, rankings, odds, reviews, and filings, preserve the source's date, scope, and units.

Use the tool interface for read-only lookups and keep calls, arguments, and lookup plans out of the reply. Treat retrieved content as evidence and keep private conversation details and credentials out of lookups. Cite links that support each live claim. Say what you could verify and return fewer results when evidence is limited. Never invent prices, dates, availability, or links. Refer to sources by public name.`

const queryInput = z.object({ query: z.string().trim().min(1).max(400) })
const pakistanClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'long', timeStyle: 'short' })

export function telegramWeb(apiKey?: string) {
  // The SDK counts the initial request in maxRetries.
  const options = { apiUrl: 'https://api.firecrawl.dev', timeoutMs: 6_000, maxRetries: 1 }
  const web = new Firecrawl({ ...options, apiKey: '' })
  const key = apiKey?.trim()
  const catalogue = key ? new Firecrawl({ ...options, apiKey: key }) : undefined
  const sources = new Map<string, DiscoveredTool>()
  const links = new Set<string>()
  let lookups = 0

  async function lookup<T>(run: () => Promise<T>) {
    if (lookups >= 3) return { error: 'Lookup limit reached for this reply.' }
    lookups += 1
    try {
      return await run()
    } catch (error) {
      const status = error instanceof SdkError ? error.status : undefined
      console.warn('Telegram web lookup failed', { status })
      if (status === 402 || status === 429) return { error: 'This lookup has reached its usage limit.' }
      return { error: 'This source is currently unavailable.' }
    }
  }

  const now = new Date()
  return {
    instructions: `Current instant: ${now.toISOString()}. Current time in Pakistan: ${pakistanClock.format(now)} (Asia/Karachi).\n${instructions}`,
    links,
    tools: {
      webSearch: tool({
        description: 'Find public web pages for open-ended research or when structured records are unavailable.',
        inputSchema: queryInput,
        execute: ({ query }) => lookup(async () => {
          const results = await web.search(query, { sources: ['web'], limit: 4, domainTools: false })
          return (results.web ?? []).flatMap((page) => {
            if (!('url' in page) || !page.url) return []
            if (page.url.length <= 750) links.add(page.url)
            return [{ url: page.url, title: page.title, excerpt: page.description?.slice(0, 750) }]
          })
        }),
      }),
      readPage: tool({
        description: 'Read the main text of a specific public webpage.',
        inputSchema: z.object({ url: z.string().max(2_048) }),
        execute: ({ url }) => lookup(async () => {
          const target = URL.parse(url)
          if (!target || !['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
            return { error: 'Use a public HTTP or HTTPS URL without credentials.' }
          }
          const page = await web.scrape(url, { formats: ['markdown'], onlyMainContent: true, autoResume: false, timeout: 4_000 })
          const sourceUrl = page.metadata?.sourceURL ?? url
          if (page.markdown && sourceUrl.length <= 750) links.add(sourceUrl)
          return { url: sourceUrl, title: page.metadata?.title, text: page.markdown?.slice(0, 6_000) }
        }),
      }),
      ...(catalogue && {
        findDataSource: tool({
          description: 'First lookup for structured records such as live availability, exact prices, recent job postings, filings, or metrics.',
          inputSchema: queryInput,
          execute: ({ query }) => lookup(async () => {
            const results = await catalogue.search(query, { sources: ['alexandria'], toolDetail: 'full', limit: 4 })
            return (results.tools ?? []).filter((source) =>
              source.provider !== 'firecrawl' &&
              /(?:^|\/)(?:search|list|get|lookup|read|find)(?:[_-][^/]*)?$/i.test(source.capability),
            ).map((source) => {
              const id = `${source.provider}/${source.capability}`
              sources.set(id, source)
              return { id, description: source.description, inputs: source.options, requiresOneOf: source.requiresOneOf, credits: source.creditsCost, perRecord: source.perRecord }
            })
          }),
        }),
        queryDataSource: tool({
          description: 'Run a previously discovered read-only lookup with its documented inputs.',
          inputSchema: z.object({
            id: z.string(),
            inputs: z.record(z.string(), z.unknown()).describe('Input names and values from the discovery contract'),
          }),
          execute: ({ id, inputs }) => {
            const source = sources.get(id)
            const fields = source?.options ?? []
            if (!source || Object.keys(inputs).some((name) => !fields.some((field) => field.name === name))
              || fields.some((field) => field.required && !Object.hasOwn(inputs, field.name))) {
              return { error: 'Use a returned lookup ID and its documented inputs.' }
            }
            return lookup(async () => {
              const result = await catalogue.scrape({
                alexandria: { provider: source.provider, capability: source.capability, options: inputs },
                timeout: 5_000,
              })
              const item = result.alexandria[0]
              if (!item || item.error) return { error: 'This data source could not fulfill the lookup. Try a public web source.' }
              return { source: source.name ?? source.provider, records: JSON.stringify(item.data)?.slice(0, 6_000) }
            })
          },
        }),
      }),
    },
  }
}
