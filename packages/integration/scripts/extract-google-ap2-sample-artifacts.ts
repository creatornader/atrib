import { parseArgs } from 'node:util'
import { extractGoogleAp2SampleArtifacts } from '../src/google-ap2-sample-extract.js'
import { readJsonFile } from '../src/ap2-local-participant.js'

const args = process.argv.slice(2)
if (args[0] === '--') args.shift()

const { values } = parseArgs({
  args,
  options: {
    'events-json': { type: 'string' },
    'temp-db-dir': { type: 'string' },
    'out-dir': { type: 'string' },
    'now-seconds': { type: 'string' },
    'context-id': { type: 'string' },
  },
})

const eventsJson = values['events-json']
const tempDbDir = values['temp-db-dir']
const outDir = values['out-dir']

if (!eventsJson || !tempDbDir || !outDir) {
  throw new Error('--events-json, --temp-db-dir, and --out-dir are required')
}

const nowSeconds = values['now-seconds'] === undefined ? undefined : Number(values['now-seconds'])
if (nowSeconds !== undefined && !Number.isSafeInteger(nowSeconds)) {
  throw new Error('--now-seconds must be an integer Unix timestamp in seconds')
}

const extracted = await extractGoogleAp2SampleArtifacts({
  events: await readJsonFile(eventsJson),
  tempDbDir,
  outDir,
  ...(nowSeconds === undefined ? {} : { nowSeconds }),
  ...(values['context-id'] ? { contextId: values['context-id'] } : {}),
})

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      files: extracted.files,
      metadata: extracted.metadata,
    },
    null,
    2,
  ) + '\n',
)
