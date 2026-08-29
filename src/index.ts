import { familyOf } from './identity'
import type { BillingMode, Benchmark, Model, Price } from './types'

export { familyOf, nameVariants, normaliseName } from './identity'

export * from './types'
export { load } from './data'

/**
 * The questions this answers.
 *
 * Two figures live side by side and are never added together. A measured
 * benchmark says the code ran and the tests passed; a vote says people liked
 * the answer better. Rotten Tomatoes keeps the critics and the audience apart
 * for the same reason — a model can write correct, joyless code, and averaging
 * those two numbers would hide exactly the thing you wanted to know.
 */

export interface Ranked {
  model: Model
  /** The benchmark this ranking is built on. */
  benchmark: Benchmark
  /** Cheapest usable price, or null when nobody sells it yet. */
  price: Price | null
}

export interface RankOptions {
  /** Which benchmark to rank by. Defaults to whichever the model has. */
  benchmark?: string
  /** Only models at or under this many dollars per million input tokens. */
  maxInput?: number
  /** Only models at or under this many dollars per million output tokens. */
  maxOutput?: number
  /** Which billing modes count as a real price. */
  modes?: BillingMode[]
  /** Drop anything with no price at all. */
  pricedOnly?: boolean
  limit?: number
}

/** Cheapest price you could actually build on. */
export function usablePrice(
  model: Model,
  modes: BillingMode[] = ['standard'],
): Price | null {
  const usable = model.prices.filter((p) => modes.includes(p.mode))
  if (usable.length === 0) return null
  return usable.reduce((low, p) => (p.input < low.input ? p : low))
}

/**
 * The best reading a model has for one benchmark.
 *
 * Scores accumulate rather than overwrite, so a model can carry several
 * readings from the same source. The most recent one is the current answer;
 * the others are the history that makes a change visible.
 */
export function latestScore(model: Model, benchmark?: string): Benchmark | null {
  const matching = benchmark
    ? model.benchmarks.filter((b) => b.name === benchmark)
    : model.benchmarks
  if (matching.length === 0) return null

  return matching.reduce((newest, b) =>
    b.provenance.fetchedAt > newest.provenance.fetchedAt ? b : newest,
  )
}

export function rank(models: Model[], options: RankOptions = {}): Ranked[] {
  const modes = options.modes ?? ['standard']
  const out: Ranked[] = []

  for (const model of models) {
    const benchmark = latestScore(model, options.benchmark)
    if (!benchmark) continue

    const price = usablePrice(model, modes)
    if (options.pricedOnly && !price) continue
    if (options.maxInput !== undefined && (!price || price.input > options.maxInput)) continue
    if (options.maxOutput !== undefined && (!price || price.output > options.maxOutput)) continue

    out.push({ model, benchmark, price })
  }

  out.sort((a, b) => b.benchmark.score - a.benchmark.score)
  return options.limit ? out.slice(0, options.limit) : out
}

/** Models seen for the first time within the last `days`. */
export function recentlyAdded(models: Model[], days = 14): Model[] {
  const cutoff = Date.now() - days * 86_400_000
  return models
    .filter((m) => new Date(m.firstSeen).getTime() >= cutoff)
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))
}

/**
 * The scored variants of a model.
 *
 * Someone asking about `claude-opus-5` wants its scores, but the leaderboard
 * measured `claude-opus-5-max` and `claude-opus-5-high` — the same weights at
 * different effort. Answering "no scores on record" would be true of the exact
 * id and useless to the person asking.
 */
export function variantsOf(models: Model[], model: Model): Model[] {
  const family = familyOf(model.id)
  return models
    .filter((m) => m.id !== model.id && familyOf(m.id) === family && m.benchmarks.length > 0)
    .sort((a, b) => (latestScore(b)?.score ?? 0) - (latestScore(a)?.score ?? 0))
}

/** Loose search, so `opus 5` finds `claude-opus-5`. */
export function search(models: Model[], query: string): Model[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  return models
    .filter((m) => {
      const haystack = `${m.id} ${m.name} ${m.maker ?? ''}`.toLowerCase()
      return terms.every((t) => haystack.includes(t))
    })
    .sort((a, b) => a.id.length - b.id.length)
}
