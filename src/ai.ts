import { createNeon } from '@neon/ai-sdk-provider'
import { APICallError, generateText, isStepCount, ToolChoiceViolationError } from 'ai'
import type { ModelMessage, ToolSet } from 'ai'

type NeonEnv = {
  NEON_AI_GATEWAY_BASE_URL: string
  NEON_AI_GATEWAY_TOKEN: string
}

type TelegramTools = { instructions: string; tools: ToolSet; links: Set<string> }

export function hasToolCallMarkup(text: string) {
  return /<\/?(?:function|tool_calls?)(?=[\s=>]|$)/i.test(text)
}

// The Neon provider's AI SDK v3 adapter encodes image tool results as generic files.
async function fetchWithToolImages(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body !== 'string' || !init.body.includes('data:image/')) return fetch(input, init)
  const body = JSON.parse(init.body) as {
    input?: { type: string; output?: string | { type: string; file_data?: string }[] }[]
  }
  for (const item of body.input ?? []) {
    if (item.type !== 'function_call_output' || !Array.isArray(item.output)) continue
    item.output = item.output.map((part) =>
      part.type === 'input_file' && part.file_data?.startsWith('data:image/')
        ? { type: 'input_image', image_url: part.file_data }
        : part,
    )
  }
  return fetch(input, { ...init, body: JSON.stringify(body) })
}

async function generateAnswer(env: NeonEnv, input: string | ModelMessage[], instructions?: string, tools?: ToolSet) {
  const signal = AbortSignal.timeout(tools?.desktop ? 120_000 : tools ? 30_000 : 12_000)
  const stepLimit = tools?.desktop ? 10 : 4
  const neon = createNeon({
    baseURL: env.NEON_AI_GATEWAY_BASE_URL,
    apiKey: env.NEON_AI_GATEWAY_TOKEN,
    ...(tools?.desktop && { fetch: fetchWithToolImages }),
  })
  let usedTools = false
  let usedComputer = false

  try {
    const model = neon(tools ? 'gpt-6-luna' : 'meta-llama-3-1-8b-instruct')
    const messages = typeof input === 'string' ? { prompt: input } : { messages: input }
    const options = {
      model,
      ...messages,
      maxRetries: 0,
      abortSignal: signal,
      maxOutputTokens: tools ? 2048 : 256,
      ...(tools && {
        providerOptions: { openai: { reasoningEffort: 'low', ...(tools.desktop && { parallelToolCalls: false }) } },
      }),
    }
    const { text } = await generateText({
      ...options,
      instructions,
      ...(tools && {
        tools,
        stopWhen: isStepCount(stepLimit),
        prepareStep: ({ stepNumber, steps }) => {
          if (stepNumber === stepLimit - 1) return { toolChoice: 'none' as const }
          if (steps.some(({ toolCalls }) => toolCalls.some(({ toolName }) =>
            toolName === 'readAttachment' || toolName === 'desktop' || toolName === 'runPython',
          ))) return { activeTools: ['readAttachment', 'runPython', 'desktop', 'returnFile'] }
        },
        onStepFinish: ({ toolCalls }) => {
          usedTools ||= toolCalls.length > 0
          usedComputer ||= toolCalls.some(({ toolName }) =>
            ['readAttachment', 'runPython', 'desktop', 'returnFile'].includes(toolName),
          )
        },
      }),
    })
    const answer = text.trim()
    if (usedComputer && hasToolCallMarkup(answer)) throw new Error('The model returned tool markup after using the sandbox')
    if (tools?.webSearch && hasToolCallMarkup(answer)) {
      usedTools = true
      const retry = await generateText({
        ...options,
        instructions: `${instructions}\nUse the web search results to give the final answer in plain text. If they do not verify the requested facts, say so.`,
        tools: { webSearch: tools.webSearch },
        toolChoice: 'required',
        stopWhen: isStepCount(2),
        prepareStep: ({ stepNumber }) => stepNumber === 1 ? { toolChoice: 'none' as const } : undefined,
      }).catch((error: unknown) => {
        if (!ToolChoiceViolationError.isInstance(error)) throw error
      })
      const recovered = retry?.text.trim()
      const searched = retry?.steps[0]?.toolResults.some(({ output }) => Array.isArray(output) && output.length > 0)
      if (!searched || !recovered || hasToolCallMarkup(recovered)) return 'I couldn’t verify that with a web search.'
      return recovered
    }
    if (!answer) throw new Error('The model returned no text')
    return answer
  } catch (error) {
    signal.throwIfAborted()
    // A rate limit after a lookup must not replay the entire turn and repeat the lookup.
    if (usedTools && APICallError.isInstance(error) && error.statusCode === 429) {
      throw new Error('Neon AI Gateway rate limited after using a tool')
    }
    throw error
  }
}

export function generateTestAnswer(
  env: NeonEnv,
  prompt = 'Earth takes about 365.24 days to orbit the Sun. Explain why most calendar years have 365 days and why we have leap years in two or three plain-text sentences.',
) {
  return generateAnswer(env, prompt)
}

export const telegramGenerationFailure = 'I couldn’t generate a reply right now. Please try again.'
export const neonRateLimit = 'Neon AI Gateway generation failed (HTTP 429)'

export async function generateTelegramAnswer(env: NeonEnv, prompt: string | ModelMessage[], web?: TelegramTools) {
  try {
    const text = await generateAnswer(env, prompt, web?.instructions ?? 'Reply concisely, in a non robotic and humane way in plain text.', web?.tools)
    const links = [...(web?.links ?? [])]
    const sources = links.length && !links.some((url) => text.includes(url))
      ? `\n\nSources checked\n${links.slice(0, 2).join('\n')}`
      : ''
    return (text.slice(0, 4096 - sources.length) + sources).toWellFormed()
  } catch (error) {
    // Provider errors can include the Telegram transcript in their request body.
    if (APICallError.isInstance(error) && error.statusCode) {
      if (error.statusCode === 429) throw new Error(neonRateLimit)
      throw new Error(`Neon AI Gateway generation failed (HTTP ${error.statusCode})`)
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('Neon AI Gateway generation timed out')
    }
    throw new Error('Neon AI Gateway generation failed')
  }
}

