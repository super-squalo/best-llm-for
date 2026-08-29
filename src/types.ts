/**
 * The shape everything else reads.
 *
 * Every number carries where it came from and when. A leaderboard that cannot
 * say which source a figure is from is worth less than no leaderboard: someone
 * picks a model on it, spends money, and has no way to check the claim.
 */

export interface Provenance {
  /** Human-readable name of where this came from. */
  source: string
  /** The exact URL it was read from. */
  url: string
  /** When it was read, ISO 8601. */
  fetchedAt: string
}

/**
 * How a price is billed.
 *
 * These are not interchangeable. Batch is roughly half price but answers in
 * hours, and a free tier is rate-limited to the point of being unusable in
 * production. Quoting either as "the price" sends someone to a product that
 * does not do what they need.
 */
export type BillingMode = 'standard' | 'batch' | 'free' | 'other'

export interface Price {
  /** US dollars per million input tokens. */
  input: number
  /** US dollars per million output tokens. */
  output: number
  /** Which vendor sells it at this price — the first party, or a reseller. */
  vendor: string
  mode: BillingMode
}

export interface Benchmark {
  /** Which benchmark: `arena-code`, `swe-bench-verified`, and so on. */
  name: string
  /**
   * Whether this figure is a measurement or an opinion.
   *
   * `measured` means a test was run and either passed or did not — SWE-bench
   * and friends. `voted` means people compared two answers and picked one,
   * which is the arena. Both are useful and they are not the same thing, so
   * they are never added together into one number.
   */
  kind: 'measured' | 'voted'
  /** The raw score, on whatever scale that benchmark uses. */
  score: number
  /** Position in that leaderboard, when the source gives one. */
  rank?: number
  /** How many votes or problems the score rests on, when known. */
  sample?: number
  provenance: Provenance
}

export interface Model {
  /** Normalised id, e.g. `claude-opus-5`. */
  id: string
  /** When this model first appeared in any source, ISO 8601. */
  firstSeen: string
  /**
   * When the model became buyable, ISO 8601 date, from OpenRouter's listing.
   *
   * `firstSeen` says when this tool noticed a model, which for everything that
   * existed before the first collector run is the same day. Comparing two
   * scores without knowing that one model is a year older than the other reads
   * a generation gap as a quality gap, so the date has to come from the outside
   * world rather than from when we happened to look.
   */
  listedAt?: string
  /** The name people actually say. */
  name: string
  /** Anthropic, OpenAI, Google, and so on. */
  maker?: string
  /** Context window in tokens, when known. */
  context?: number
  /** Every price found, first-party and resellers alike. */
  prices: Price[]
  /** Every benchmark result found. */
  benchmarks: Benchmark[]
}

export interface Dataset {
  /** When the collector last ran, ISO 8601. */
  generatedAt: string
  /** Every source it tried, and how that went. */
  sources: SourceReport[]
  /** Models that appeared for the first time on this run. */
  newModels: string[]
  models: Model[]
}

export interface SourceReport {
  name: string
  url: string
  ok: boolean
  /** How many records it contributed. */
  records: number
  /** Why it failed, when it did. */
  error?: string
}

/**
 * Cheapest price you can actually build on, or null when none is known.
 *
 * Batch and free tiers are excluded by default: they are cheaper for reasons
 * that matter — hours of latency, or limits that make them unusable — and
 * quoting one as the price answers a question nobody asked.
 */
export function cheapestInput(
  model: Model,
  modes: BillingMode[] = ['standard'],
): Price | null {
  const usable = model.prices.filter((p) => modes.includes(p.mode))
  if (usable.length === 0) return null
  return usable.reduce((low, p) => (p.input < low.input ? p : low))
}

/** The score for one benchmark, or null when this model was never measured on it. */
export function scoreFor(model: Model, benchmark: string): Benchmark | null {
  return model.benchmarks.find((b) => b.name === benchmark) ?? null
}

export interface Loaded {
  data: Dataset
  /** Where the figures came from, for the footer line. */
  origin: 'cache' | 'network' | 'bundled'
  /** How old they are, in hours. */
  ageHours: number
}
