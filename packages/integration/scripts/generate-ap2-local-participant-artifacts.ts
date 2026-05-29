import { parseArgs } from 'node:util'
import { generateAp2LocalParticipantArtifacts, readJsonFile } from '../src/ap2-local-participant.js'

const args = process.argv.slice(2)
if (args[0] === '--') args.shift()

const { values } = parseArgs({
  args,
  options: {
    'result-json': { type: 'string' },
    'evidence-json': { type: 'string' },
    'out-dir': { type: 'string' },
    'now-seconds': { type: 'string', default: '1779840000' },
  },
})

const resultJson = values['result-json']
const evidenceJson = values['evidence-json']
const outDir = values['out-dir']

if (!resultJson || !evidenceJson || !outDir) {
  throw new Error('--result-json, --evidence-json, and --out-dir are required')
}

const nowSeconds = Number(values['now-seconds'])
if (!Number.isSafeInteger(nowSeconds)) {
  throw new Error('--now-seconds must be an integer Unix timestamp in seconds')
}

const artifacts = await generateAp2LocalParticipantArtifacts({
  result: await readJsonFile(resultJson),
  evidence: await readJsonFile(evidenceJson),
  outDir,
  nowSeconds,
})

console.log(
  JSON.stringify(
    {
      ok: true,
      files: artifacts.files,
    },
    null,
    2,
  ),
)
