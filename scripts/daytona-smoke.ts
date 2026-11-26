import { Daytona } from '@daytona/sdk'

async function main() {
  const apiKey = process.env.DAYTONA_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('Set DAYTONA_API_KEY in the shell or .env.local. Create a key at https://app.daytona.io/dashboard/keys')
  }

  const daytona = new Daytona({ apiKey })
  const sandbox = await daytona.v0.create({ language: 'typescript' })
  try {
    const { exitCode, result } = await sandbox.process.executeCommand(`node -e 'console.log("Hello World")'`, undefined, undefined, 30)
    if (exitCode !== 0 || result.trim() !== 'Hello World') {
      throw new Error(`Sandbox program returned unexpected output (exit code ${exitCode}).`)
    }
    console.log(result.trim())
  } finally {
    await daytona.v0.delete(sandbox, 30, true)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Daytona smoke test failed.')
  process.exitCode = 1
})
