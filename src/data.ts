import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Dataset, Loaded } from './types'

/**
 * Getting the data in front of the answer.
 *
 * Three places are tried, in order of freshness: a local cache from the last
 * day, then the published file, then the copy shipped inside the package. The
 * last one means the tool still answers on a plane or behind a firewall — with
 * older figures, and it says so rather than passing them off as current.
 */

const PUBLISHED =
  'https://raw.githubusercontent.com/supersqualoyt/which-llm/main/data/models.json'

const CACHE_HOURS = 6

function cachePath(): string {
  const base =
    process.env['XDG_CACHE_HOME'] ??
    (process.platform === 'win32'
      ? process.env['LOCALAPPDATA'] ?? tmpdir()
      : join(homedir(), '.cache'))
  return join(base, 'which-llm', 'models.json')
}

function bundledPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'data', 'models.json')
}

function readIfValid(path: string): Dataset | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Dataset
    /* A file that parses but holds nothing is worse than no file: it would
     * answer "no models found" as though that were the truth. */
    return parsed.models?.length ? parsed : null
  } catch {
    return null
  }
}

function ageInHours(path: string): number {
  try {
    return (Date.now() - statSync(path).mtimeMs) / 3_600_000
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export async function load(options: { refresh?: boolean } = {}): Promise<Loaded> {
  const cache = cachePath()

  if (!options.refresh && ageInHours(cache) < CACHE_HOURS) {
    const cached = readIfValid(cache)
    if (cached) {
      return { data: cached, origin: 'cache', ageHours: ageInHours(cache) }
    }
  }

  try {
    const res = await fetch(PUBLISHED, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = (await res.json()) as Dataset
    if (!data.models?.length) throw new Error('published file has no models')

    try {
      mkdirSync(dirname(cache), { recursive: true })
      writeFileSync(cache, JSON.stringify(data), 'utf8')
    } catch {
      /* An unwritable cache is not worth failing over. */
    }

    return { data, origin: 'network', ageHours: 0 }
  } catch {
    /* Offline, or the published file moved. Anything already on disk beats
     * refusing to answer. */
    const cached = readIfValid(cache)
    if (cached) return { data: cached, origin: 'cache', ageHours: ageInHours(cache) }

    const bundled = readIfValid(bundledPath())
    if (bundled) {
      const age =
        (Date.now() - new Date(bundled.generatedAt).getTime()) / 3_600_000
      return { data: bundled, origin: 'bundled', ageHours: age }
    }

    throw new Error(
      'No data available: could not reach the network, and no cached or bundled copy was found.',
    )
  }
}
