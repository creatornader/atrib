import {
  clearRecordReferenceResolverCacheForTests as clearSharedRecordReferenceResolverCacheForTests,
  defaultRecordReferenceResolver as sharedDefaultRecordReferenceResolver,
  type RecordReferenceResolution,
} from '@atrib/mcp'

export type RecordReferenceResolver = (
  recordHash: string,
) => RecordReferenceResolution | Promise<RecordReferenceResolution>

interface FilterResolvableInformedByOptions {
  allowUnresolved?: boolean | undefined
  resolver?: RecordReferenceResolver | undefined
  logEndpoint?: string | undefined
  warnings: string[]
}

export const defaultRecordReferenceResolver = sharedDefaultRecordReferenceResolver

export async function filterResolvableInformedBy(
  refs: string[] | undefined,
  options: FilterResolvableInformedByOptions,
): Promise<string[] | undefined> {
  if (!refs || refs.length === 0) return undefined

  const unique = [...new Set(refs)]
  if (options.allowUnresolved) return unique

  const kept: string[] = []
  const resolver =
    options.resolver ??
    ((recordHash: string) => defaultRecordReferenceResolver(recordHash, options.logEndpoint))

  for (const ref of unique) {
    const resolution = await resolver(ref)
    if (resolution === 'found') {
      kept.push(ref)
      continue
    }
    if (resolution === 'unknown') {
      options.warnings.push(
        `dropped unvalidated informed_by reference ${shortHash(ref)}; validation unavailable`,
      )
      continue
    }
    options.warnings.push(
      `dropped unresolved informed_by reference ${shortHash(ref)}; not found in local mirrors or log lookup`,
    )
  }

  return kept.length > 0 ? kept : undefined
}

function shortHash(recordHash: string): string {
  return `${recordHash.slice(0, 19)}...${recordHash.slice(-8)}`
}

export function clearRecordReferenceResolverCacheForTests(): void {
  clearSharedRecordReferenceResolverCacheForTests()
}
