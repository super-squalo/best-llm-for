import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { familyOf, normaliseName } from './identity'

/**
 * Reading the grid the CLI answers from.
 *
 * The file ships inside the package, so the questions this answers work with
 * no network at all. It is rebuilt daily and republished with each release;
 * the age is shown rather than hidden, because a benchmark table three months
 * stale is still useful and pretending otherwise is not.
 */

/** One figure: the score, who produced it, and where to check it. */
export interface Claim {
  benchmark: string
  reportedAs?: string
  labelEvidence?: string
  score: number
  /** `claimed` is the lab's own figure for its own model; `measured` is not. */
  kind: 'claimed' | 'measured'
  by: string
  source: string
  capturedAt: string
}

export interface GridRow {
  model: string
  family: string
  maker?: string
  released?: string
  listedAt?: string
  contextTokens?: number
  priceInput?: number
  priceOutput?: number
  claims: Claim[]
}

/**
 * What a person scores on the same test.
 *
 * Kept apart from the model rows: each of these was produced by a different
 * method — one medallist on twenty problems, four hundred volunteers on a
 * puzzle set, an estimate from a professional exam's 95th percentile — so it
 * reads as context beside the ranking, never as one more competitor inside it.
 */
export interface HumanBaseline {
  benchmark: string
  score: number
  /** Which people, doing what. Never just "humans". */
  who: string
  source: string
  quote: string
}

export interface Grid {
  generatedAt: string
  humans: HumanBaseline[]
  benchmarks: string[]
  labelling: { change: string; evidence?: string }[]
  sources: { name: string; kind: string; records: number; dropped?: number; url: string }[]
  rows: GridRow[]
}

export function loadGrid(): Grid {
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, '..', 'data', 'grid.json'), 'utf8')) as Grid
}

/** How many models carry a figure for each benchmark. */
export function coverage(grid: Grid): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of grid.rows) {
    for (const name of new Set(row.claims.map((c) => c.benchmark))) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * The benchmark someone meant.
 *
 * Nobody types `LiveBench/code_generation`. An exact name wins, then a name
 * that starts with what was typed, then anything containing it — so `gpqa`
 * finds GPQA-Diamond and `code` finds the coding tasks, in coverage order so
 * the first suggestion is the one with something to compare.
 */
export function findBenchmarks(grid: Grid, query: string): string[] {
  const q = query.toLowerCase()
  const counts = coverage(grid)

  const exact = grid.benchmarks.filter((b) => b.toLowerCase() === q)
  if (exact.length > 0) return exact

  const starts = grid.benchmarks.filter((b) => b.toLowerCase().startsWith(q))
  const contains = grid.benchmarks.filter(
    (b) => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q),
  )

  return [...starts, ...contains].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
}

/** Every score on one benchmark, best first. */
export interface Ranking {
  row: GridRow
  claim: Claim
  /** The lab's own figure, when an outsider's is the one being shown. */
  alsoClaimed?: Claim
}

/**
 * Ranked on one benchmark, with the outsider's figure preferred.
 *
 * Where a lab and an independent runner both have a number, the independent
 * one leads and the lab's is carried alongside rather than dropped: the pair
 * is more informative than either, and which is bigger is the reader's to
 * notice.
 */
export function onBenchmark(grid: Grid, benchmark: string): Ranking[] {
  const rankings: Ranking[] = []

  for (const row of grid.rows) {
    const claims = row.claims.filter((c) => c.benchmark === benchmark)
    if (claims.length === 0) continue

    const measured = claims.find((c) => c.kind === 'measured')
    const claimed = claims.find((c) => c.kind === 'claimed')
    const lead = measured ?? claimed
    if (!lead) continue

    rankings.push({
      row,
      claim: lead,
      ...(measured && claimed ? { alsoClaimed: claimed } : {}),
    })
  }

  /* Hallucination rate is the one benchmark here where less is better. Sorting
   * it like the others would put the worst model on top of the list. */
  const lowerIsBetter = benchmark === 'Hallucination-Rate'
  return rankings.sort((a, b) =>
    lowerIsBetter ? a.claim.score - b.claim.score : b.claim.score - a.claim.score,
  )
}

/** The published human figures for one benchmark, best first. */
export function humansOn(grid: Grid, benchmark: string): HumanBaseline[] {
  return (grid.humans ?? [])
    .filter((h) => h.benchmark === benchmark)
    .sort((a, b) => b.score - a.score)
}

/** Every row for one model, including the same weights at other settings. */
export function rowsForModel(grid: Grid, query: string): GridRow[] {
  const wanted = normaliseName(query)
  const family = familyOf(query)

  const exact = grid.rows.filter((r) => normaliseName(r.model) === wanted)
  if (exact.length > 0) {
    /* Everything sharing the family: `-high` and `-max` are the same model
     * thinking for longer, and someone asking about one wants both. */
    return grid.rows.filter((r) => r.family === (exact[0] as GridRow).family)
  }

  const sameFamily = grid.rows.filter((r) => r.family === family)
  if (sameFamily.length > 0) return sameFamily

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return grid.rows
    .filter((r) => terms.every((t) => r.model.toLowerCase().includes(t)))
    .sort((a, b) => b.claims.length - a.claims.length)
}
