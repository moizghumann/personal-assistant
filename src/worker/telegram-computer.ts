import { Buffer } from 'node:buffer'
import { Daytona } from '@daytona/sdk'
import type { Sandbox } from '@daytona/sdk/v0'
import { tool } from 'ai'
import { z } from 'zod'
import type { TelegramAttachment, TelegramDocument } from '../telegram-api.js'

const maxInputBytes = 10 * 1024 * 1024
// shortcut: one 1 MiB reply fits in the existing Durable Object storage, use object storage for larger exports.
const maxOutputBytes = 1024 * 1024
const outbox = '/tmp/telegram-outbox'
const safeFilename = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/
const pythonPackages = '/tmp/telegram-python'
const installPackages = 'python3 -m pip install --disable-pip-version-check --no-input --only-binary=:all: ' +
  '--target ' + pythonPackages + ' PyMuPDF==1.28.2 Pillow==12.2.0 openpyxl==3.1.5 python-docx==1.2.0'
const desktopInput = z.object({ operation: z.discriminatedUnion('action', [
  z.object({ action: z.literal('screenshot') }),
  z.object({ action: z.literal('click'), x: z.number().int().min(0).max(4096), y: z.number().int().min(0).max(4096) }),
  z.object({ action: z.literal('type'), text: z.string().max(4000) }),
  z.object({ action: z.literal('press'), key: z.string().max(30), modifiers: z.array(z.enum(['ctrl', 'shift', 'alt', 'meta'])).max(4) }),
  z.object({ action: z.literal('openAttachment') }),
]) })

type ToolOutput = string | { mediaType: string; data: string }

function imageOutput({ output }: { output: ToolOutput }) {
  if (typeof output === 'string') return { type: 'text' as const, value: output }
  return {
    type: 'content' as const,
    value: [{ type: 'file' as const, mediaType: output.mediaType, data: { type: 'data' as const, data: output.data } }],
  }
}

async function downloadAttachment(token: string, file: TelegramAttachment) {
  if ((file.size ?? 0) > maxInputBytes) throw new Error('This attachment exceeds the 10 MiB limit.')
  const api = `https://api.telegram.org/bot${token}/getFile`
  const response = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: file.fileId }),
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  const info = await response.json() as { ok?: boolean; result?: { file_path?: string } }
  const path = info.result?.file_path
  if (!response.ok || !info.ok || typeof path !== 'string' ||
      !path.split('/').every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')) {
    throw new Error('Telegram file could not be located.')
  }
  const download = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  })
  if (!download.ok || !download.body) throw new Error('Telegram file could not be downloaded.')
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = download.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxInputBytes) {
      await reader.cancel()
      throw new Error('This attachment exceeds the 10 MiB limit.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, size)
}

async function run(sandbox: Sandbox, command: string, timeout = 15) {
  const { exitCode, result } = await sandbox.process.executeCommand(command, undefined, undefined, timeout)
  if (exitCode !== 0) throw new Error('The sandbox command failed.')
  return result
}

export function telegramComputer(apiKey: string, botToken: string, attachment?: TelegramAttachment) {
  const daytona = new Daytona({ apiKey })
  const extension = attachment?.mimeType === 'application/pdf'
    ? '.pdf'
    : attachment?.name.match(/\.[a-z0-9]{1,12}$/i)?.[0].toLowerCase() ?? ''
  const imageTypes = new Map([['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']])
  const imageType = imageTypes.get(extension.slice(1))
  const input = '/tmp/telegram-input' + extension
  let created: Sandbox | undefined
  let ready: Promise<Sandbox> | undefined
  let bytes: Promise<Buffer> | undefined
  let mounted: Promise<Sandbox> | undefined
  let desktop: Promise<void> | undefined
  let document: TelegramDocument | undefined

  const getSandbox = () => ready ??= (async () => {
    created = await daytona.v0.create(
      { language: 'typescript', ephemeral: true, autoStopInterval: 5 },
      { timeout: 35 },
    )
    // Setup uses fixed packages. Block egress before uploading a file or executing agent code.
    await run(created, installPackages, 30)
    await created.updateNetworkSettings({ networkBlockAll: true })
    await created.fs.createFolder(outbox, '755')
    return created
  })()
  const getBytes = () => bytes ??= attachment ? downloadAttachment(botToken, attachment) : Promise.reject(new Error('No attachment.'))
  const mount = () => mounted ??= (async () => {
    const sandbox = await getSandbox()
    await sandbox.fs.uploadFile(await getBytes(), input, 15)
    return sandbox
  })()
  const queue = (name: string, data: Buffer) => {
    if (!data.length || data.length > maxOutputBytes) return 'The reply file must be between 1 byte and 1 MiB.'
    document = { name, bytes: new Uint8Array(data).buffer }
    return `Queued ${name} for delivery with the reply.`
  }

  const tools = {
    readAttachment: tool({
      description: 'Preview a text file or image. Use runPython to inspect PDFs, spreadsheets, and other formats.',
      inputSchema: z.object({}),
      async execute(): Promise<ToolOutput> {
        if (!attachment) return 'There is no attachment in this conversation.'
        if ((attachment.size ?? 0) > maxInputBytes) return 'This attachment exceeds the 10 MiB limit.'
        try {
          if (imageType) {
            const data = await getBytes()
            if (data.length > 2 * 1024 * 1024) return 'Image previews are limited to 2 MiB.'
            return { mediaType: imageType, data: data.toString('base64') }
          }
          if (attachment.mimeType?.startsWith('text/') || /\.(?:txt|csv|json|md|tsv)$/i.test(attachment.name)) {
            return new TextDecoder().decode((await getBytes()).subarray(0, 12_000))
          }
          return 'This format has no direct preview. Use runPython to inspect it.'
        } catch {
          console.warn('Telegram attachment read failed')
          return 'I couldn’t read the attachment. It may be protected, invalid, too large, or temporarily unavailable.'
        }
      },
      toModelOutput: imageOutput,
    }),
    runPython: tool({
      description: [
        'Run Python in an isolated, offline workspace to inspect, transform, verify, or create files.',
        'PyMuPDF (pymupdf), Pillow (PIL), openpyxl, and python-docx (docx) are installed.',
        attachment ? 'Set useAttachment to mount the current attachment at ' + input + '.' : 'This turn has no input file.',
        'Print concise results. Save deliverables in ' + outbox + ' and call returnFile with the filename.',
        'Multiple runs share the workspace until this reply finishes.',
      ].join(' '),
      inputSchema: z.object({ code: z.string().min(1).max(16_000), useAttachment: z.boolean() }),
      async execute({ code, useAttachment }) {
        if (useAttachment && !attachment) return { error: 'There is no attachment to mount.' }
        try {
          const sandbox = await (useAttachment ? mount() : getSandbox())
          const script = '/tmp/telegram-task.py'
          await sandbox.fs.uploadFile(Buffer.from(code), script, 15)
          const { exitCode, result } = await sandbox.process.executeCommand(
            "set -o pipefail; timeout -k 1s 25s python3 -u /tmp/telegram-task.py 2>&1 | head -c 12000",
            outbox,
            { PYTHONPATH: pythonPackages },
            30,
          )
          return { exitCode, output: result.slice(0, 12_000) }
        } catch {
          return { error: 'The workspace could not run this program.' }
        }
      },
    }),
    desktop: tool({
      description: `Use an isolated desktop to inspect or edit files. Take a screenshot to see the desktop. Save files to ${outbox} before returning them. The desktop has no web access.`,
      inputSchema: desktopInput,
      async execute({ operation: action }: z.infer<typeof desktopInput>): Promise<ToolOutput> {
        if (action.action === 'openAttachment' && !attachment) return 'There is no attachment to open.'
        try {
          const sandbox = action.action === 'openAttachment' ? await mount() : await getSandbox()
          const computer = sandbox.computerUse
          await (desktop ??= computer.start().then(() => {}))
          switch (action.action) {
            case 'screenshot': {
              const { screenshot, sizeBytes } = await computer.screenshot.takeCompressed({ format: 'jpeg', quality: 55 })
              if (!screenshot) return 'No screenshot was captured.'
              if ((sizeBytes ?? screenshot.length * 0.75) > maxOutputBytes) return 'The screenshot exceeds the preview size limit.'
              return { mediaType: 'image/jpeg', data: screenshot }
            }
            case 'click': await computer.mouse.click(action.x, action.y); break
            case 'type': await computer.keyboard.type(action.text); break
            case 'press': await computer.keyboard.press(action.key, action.modifiers); break
            case 'openAttachment':
              await run(sandbox, `DISPLAY=:0 xdg-open '${input}' >/tmp/telegram-open.log 2>&1 &`)
              break
          }
          return 'Action performed.'
        } catch {
          return 'The desktop action failed.'
        }
      },
      toModelOutput: imageOutput,
    }),
    returnFile: tool({
      description: `Send one generated file back to the current chat. Save the file in ${outbox} first, then supply its filename.`,
      inputSchema: z.object({ filename: z.string().regex(safeFilename) }),
      async execute({ filename }) {
        try {
          const sandbox = await getSandbox()
          const path = `${outbox}/${filename}`
          const size = Number((await run(sandbox, `test -f '${path}' && test ! -L '${path}' && test ! -L '${outbox}' && stat -c %s '${path}'`)).trim())
          if (!Number.isSafeInteger(size) || size <= 0 || size > maxOutputBytes) return 'The reply file must be between 1 byte and 1 MiB.'
          return queue(filename, await sandbox.fs.downloadFile(path, 15))
        } catch {
          return 'The requested file could not be exported from the sandbox.'
        }
      },
    }),
  }

  return {
    tools,
    get document() { return document },
    async close() {
      if (!created) return
      await daytona.v0.delete(created, 10, true).catch(() => console.warn('Daytona sandbox cleanup failed'))
    },
  }
}
