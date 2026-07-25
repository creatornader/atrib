import { existsSync } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Append one complete JSON line and make a newly created path durable. */
export async function appendJsonLineDurably(path: string, value: unknown): Promise<void> {
  const parent = dirname(path)
  await mkdir(parent, { recursive: true })
  const existed = existsSync(path)
  const handle = await open(path, 'a', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }

  if (!existed) {
    const directory = await open(parent, 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
}
