import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { familyOf, nameVariants, normaliseName } from '../src/identity'
import { foldKey, resolveBenchmark } from './benchmarks'

/**
 * Every model's own numbers, from the lab that built it, in one grid.
 *
 * Labs publish two things on launch day: their own results, and their rivals'.
 * Only the first is worth keeping. The rival column is the publisher's version
 * of someone else's product — OpenAI's table sets its 2025 models against
 * Claude 3.5 Sonnet, Claude 3 Opus, Gemini 1.0 Ultra and Llama 3.1, all from
 * 2024 or earlier, all a generation behind what existed that day. Nobody picks
 * a rival's best run to stand next to.
 *
 * So a score is kept only when the lab that published it also built the model.
 * Anthropic's figures for Claude, OpenAI's for GPT, Google's for Gemini. Every
 * number in the grid is a claim its own maker is accountable for, and the
 * comparison happens here rather than in anyone's marketing.
 */

const here = dirname(fileURLToPath(import.meta.url))
const BENCH_DIR = join(here, '..', 'data', 'benchmarks')
const SPEC_DIR = join(here, '..', 'data', 'specs')
const INDEP_DIR = join(here, '..', 'data', 'independent')
const OUT = join(here, '..', 'data', 'grid.json')
const MODELS = join(here, '..', 'data', 'models.json')
const HUMAN = join(here, '..', 'data', 'human', 'baselines.json')

interface BenchmarkFile {
  benchmarkSet: string
  source: string
  note?: string
  capturedAt: string
  benchmarks: string[]
  entries: {
    model: string
    reportedBy: string
    source: string
    scores: Record<string, number>
  }[]
}

interface SpecFile {
  maker: string
  source: string
  note?: string
  models: {
    id: string
    name: string
    released?: string
    contextTokens?: number
    maxOutputTokens?: number
    priceInput?: number
    priceOutput?: number
    parameters?: string
    knowledgeCutoff?: string
  }[]
}

/** One figure: the score, who produced it, and where it can be checked. */
export interface Claim {
  benchmark: string
  /**
   * The label the source printed, when the grid files the score elsewhere.
   *
   * OpenAI's `GPQA` column is GPQA-Diamond; saying so without keeping the
   * original word would leave a reader unable to find the number back on the
   * page it came from.
   */
  reportedAs?: string
  /** What proves the rename — the source's own code or wording. */
  labelEvidence?: string
  score: number
  /**
   * `claimed` is the lab's own figure for its own model. `measured` is someone
   * else running the test. Both belong in the grid and neither replaces the
   * other: a lab marking its own homework and an outsider checking it are
   * different kinds of evidence, and the gap between them is the interesting
   * part.
   */
  kind: 'claimed' | 'measured'
  /** Who produced this figure. */
  by: string
  source: string
  capturedAt: string
}

export interface GridRow {
  model: string
  /**
   * The model underneath the settings.
   *
   * LiveBench ran `claude-opus-4-7-xhigh-effort`, the arena ran
   * `claude-opus-4-7`, and a price feed sells `claude-opus-4.7`. Three rows,
   * one model: they keep their own scores, because the setting changes the
   * score, and they share a family so the rest of the table can put them next
   * to each other instead of scattering them alphabetically.
   */
  family: string
  maker?: string
  /** The maker's own launch date, when its documentation states one. */
  released?: string
  /**
   * The day the model turned up for sale on OpenRouter, ISO 8601 date.
   *
   * Second best to a launch date and clearly labelled as such, but it covers
   * models whose makers never published one. Without a date on the row, a
   * table sorted by score reads a two-year gap as a quality gap: a 2024 model
   * scoring under a 2026 one is not the same finding as two 2026 models
   * differing by the same margin.
   */
  listedAt?: string
  contextTokens?: number
  maxOutputTokens?: number
  priceInput?: number
  priceOutput?: number
  knowledgeCutoff?: string
  claims: Claim[]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
}

/**
 * Which lab built a model, read from its name.
 *
 * Needed to tell a lab's own results from its account of a rival's. Anything
 * unrecognised is left unattributed rather than guessed at, and its scores are
 * dropped along with the rest.
 */
const MAKERS: [RegExp, string][] = [
  [/^(gpt|o\d|chatgpt|davinci|text-)/i, 'OpenAI'],
  [/^claude/i, 'Anthropic'],
  [/^gemini|^palm|^gemma/i, 'Google'],
  [/^llama|^codellama/i, 'Meta'],
  [/^grok/i, 'xAI'],
  [/^deepseek/i, 'DeepSeek'],
  [/^qwen/i, 'Alibaba'],
  [/^kimi/i, 'Moonshot'],
  [/^mistral|^mixtral|^codestral/i, 'Mistral'],
  [/^glm/i, 'Zhipu'],
  [/^command/i, 'Cohere'],
  [/^phi/i, 'Microsoft'],
  [/^nova/i, 'Amazon'],
]

function makerOf(model: string): string | undefined {
  for (const [pattern, maker] of MAKERS) {
    if (pattern.test(model.trim())) return maker
  }
  return undefined
}

/**
 * What a person scores on the same test.
 *
 * The comparison the whole field started with and mostly stopped printing.
 * Kept apart from the model rows on purpose: a human baseline is measured
 * differently every time — one IMO medallist on twenty problems, four hundred
 * volunteers on a puzzle set, an estimate from the 95th percentile of a
 * professional exam — so it belongs next to the table as a line of context,
 * never inside it as another competitor.
 *
 * Only figures whose source states them in a sentence, and the sentence comes
 * along. Most benchmarks have no human baseline at all, and that silence is
 * left visible rather than filled with a plausible number.
 */
export interface HumanBaseline {
  benchmark: string
  score: number
  /** Which people, doing what. Never just "humans". */
  who: string
  source: string
  quote: string
}

function humanBaselines(): HumanBaseline[] {
  try {
    return readJson<{ entries: HumanBaseline[] }>(HUMAN).entries
  } catch {
    return []
  }
}

/** What the market says about a model: when it appeared, and what it costs. */
interface MarketFacts {
  listedAt?: string
  priceInput?: number
  priceOutput?: number
  contextTokens?: number
}

/**
 * Prices and dates from the collector, indexed by every spelling of a model.
 *
 * The scores and the prices come from different worlds — leaderboards name a
 * model by its run, marketplaces by their SKU — so they are joined here rather
 * than at either end. Cheapest standard rate only: a batch or free tier is a
 * different product at a different latency, and quoting one as the price of
 * the thing that earned the score answers a question nobody asked.
 */
function marketFacts(): Map<string, MarketFacts> {
  const facts = new Map<string, MarketFacts>()

  interface CollectedModel {
    id: string
    listedAt?: string
    context?: number
    prices: { input: number; output: number; mode: string }[]
  }

  let models: CollectedModel[]
  try {
    models = readJson<{ models: CollectedModel[] }>(MODELS).models
  } catch {
    /* No collector run yet. The grid still builds: the scores are the point,
     * the market facts are context. */
    return facts
  }

  for (const m of models) {
    const standard = m.prices.filter((p) => p.mode === 'standard')
    const cheapest = standard.reduce<{ input: number; output: number } | undefined>(
      (low, p) => (!low || p.input < low.input ? p : low),
      undefined,
    )
    if (!m.listedAt && !cheapest && !m.context) continue

    for (const k of nameVariants(m.id)) {
      const seen = facts.get(k) ?? {}
      /* A model relisted later under a new alias did not come out twice. */
      if (m.listedAt && (!seen.listedAt || m.listedAt < seen.listedAt)) seen.listedAt = m.listedAt
      if (cheapest && (seen.priceInput === undefined || cheapest.input < seen.priceInput)) {
        seen.priceInput = cheapest.input
        seen.priceOutput = cheapest.output
      }
      if (m.context && (seen.contextTokens ?? 0) < m.context) seen.contextTokens = m.context
      facts.set(k, seen)
    }
  }
  return facts
}

function main(): void {
  const rows = new Map<string, GridRow>()
  const benchmarks = new Set<string>()
  /* Every label the grid filed under a different name, and why. Printed at the
   * end so a rename can never happen quietly. */
  const renames = new Map<string, string | undefined>()
  const sources: {
    name: string
    kind: string
    records: number
    dropped?: number
    url: string
  }[] = []

  const row = (name: string): GridRow => {
    const k = normaliseName(name)
    const existing = rows.get(k)
    if (existing) return existing
    const created: GridRow = { model: name, family: familyOf(name), claims: [] }
    rows.set(k, created)
    return created
  }

  /* --- what each lab claims ---------------------------------------------- */

  for (const file of listJson(BENCH_DIR)) {
    const data = readJson<BenchmarkFile>(join(BENCH_DIR, file))

    let kept = 0
    let dropped = 0

    for (const entry of data.entries) {
      /* A lab's account of a rival's model is that lab's framing, chosen to
       * flatter its own launch. Only self-reported figures make the grid. */
      const maker = makerOf(entry.model)
      if (maker !== entry.reportedBy) {
        dropped++
        continue
      }
      kept++

      const target = row(entry.model)
      target.maker ??= maker
      for (const [label, score] of Object.entries(entry.scores)) {
        /* What the source called it is not always what it ran. */
        const { benchmark, reportedAs, evidence } = resolveBenchmark(
          data.benchmarkSet,
          label,
          entry.model,
        )
        if (reportedAs) renames.set(`${data.benchmarkSet}: ${reportedAs} -> ${benchmark}`, evidence)
        benchmarks.add(benchmark)

        /* The same lab claiming the same figure twice adds nothing. */
        const seen = target.claims.some(
          (c) => c.benchmark === benchmark && c.by === entry.reportedBy && c.score === score,
        )
        if (seen) continue

        target.claims.push({
          benchmark,
          ...(reportedAs ? { reportedAs } : {}),
          ...(evidence ? { labelEvidence: evidence } : {}),
          score,
          kind: 'claimed',
          by: entry.reportedBy,
          source: entry.source,
          capturedAt: data.capturedAt,
        })
      }
    }

    sources.push({
      name: data.benchmarkSet,
      kind: 'self-reported',
      records: kept,
      dropped,
      url: data.source,
    })
  }

  /* --- what outsiders measured ------------------------------------------- */

  for (const file of listJson(INDEP_DIR)) {
    const data = readJson<{
      benchmarkSet: string
      source: string
      capturedAt: string
      benchmarks: string[]
      entries: {
        model: string
        measuredBy: string
        source: string
        scores: Record<string, number | null>
      }[]
    }>(join(INDEP_DIR, file))

    for (const entry of data.entries) {
      const target = row(entry.model)
      target.maker ??= makerOf(entry.model)

      for (const [label, score] of Object.entries(entry.scores)) {
        if (score === null) continue

        const { benchmark, reportedAs, evidence } = resolveBenchmark(
          data.benchmarkSet,
          label,
          entry.model,
        )
        if (reportedAs) renames.set(`${data.benchmarkSet}: ${reportedAs} -> ${benchmark}`, evidence)
        benchmarks.add(benchmark)

        const seen = target.claims.some(
          (c) => c.benchmark === benchmark && c.by === entry.measuredBy && c.score === score,
        )
        if (seen) continue

        target.claims.push({
          benchmark,
          ...(reportedAs ? { reportedAs } : {}),
          ...(evidence ? { labelEvidence: evidence } : {}),
          score,
          kind: 'measured',
          by: entry.measuredBy,
          source: entry.source,
          capturedAt: data.capturedAt,
        })
      }
    }

    sources.push({
      name: data.benchmarkSet,
      kind: 'independent',
      records: data.entries.length,
      url: data.source,
    })
  }

  /* --- what the makers say about the models themselves -------------------- */

  for (const file of listJson(SPEC_DIR)) {
    const data = readJson<SpecFile>(join(SPEC_DIR, file))

    for (const m of data.models) {
      const target = row(m.name)
      target.maker ??= data.maker
      target.released ??= m.released
      target.contextTokens ??= m.contextTokens
      target.maxOutputTokens ??= m.maxOutputTokens
      target.priceInput ??= m.priceInput
      target.priceOutput ??= m.priceOutput
      target.knowledgeCutoff ??= m.knowledgeCutoff
    }

    sources.push({
      name: `${data.maker} specifications`,
      kind: 'specs',
      records: data.models.length,
      url: data.source,
    })
  }

  /* --- one spelling per test ---------------------------------------------- */

  /* Sources spell the same benchmark several ways, and which spelling the grid
   * shows should not depend on which file happened to load first. The winner
   * is the spelling the most claims use, then the shortest, then alphabetical
   * — stable across runs, so a column does not rename itself overnight. */
  const spellings = new Map<string, Map<string, number>>()
  for (const r of rows.values()) {
    for (const c of r.claims) {
      const fold = foldKey(c.benchmark)
      const counts = spellings.get(fold) ?? new Map<string, number>()
      counts.set(c.benchmark, (counts.get(c.benchmark) ?? 0) + 1)
      spellings.set(fold, counts)
    }
  }

  const canonical = new Map<string, string>()
  for (const [fold, counts] of spellings) {
    const [winner] = [...counts].sort(
      (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]),
    )
    if (!winner) continue
    canonical.set(fold, winner[0])

    for (const [spelling] of counts) {
      if (spelling !== winner[0]) {
        renames.set(
          `spelling: ${spelling} -> ${winner[0]}`,
          'Same label, different spacing or capitalisation.',
        )
      }
    }
  }

  benchmarks.clear()
  for (const r of rows.values()) {
    for (const c of r.claims) {
      const chosen = canonical.get(foldKey(c.benchmark))
      if (chosen && chosen !== c.benchmark) {
        c.reportedAs ??= c.benchmark
        c.benchmark = chosen
      }
      benchmarks.add(c.benchmark)
    }
  }

  /* --- when each model came out ------------------------------------------- */

  const facts = marketFacts()
  let dated = 0
  let priced = 0

  for (const r of rows.values()) {
    for (const k of nameVariants(r.model)) {
      const found = facts.get(k)
      if (!found) continue
      r.listedAt ??= found.listedAt
      r.priceInput ??= found.priceInput
      r.priceOutput ??= found.priceOutput
      r.contextTokens ??= found.contextTokens
      break
    }
    if (r.listedAt) dated++
    if (r.priceInput !== undefined) priced++
  }

  const humans = humanBaselines()

  const grid = {
    generatedAt: new Date().toISOString(),
    humans,
    benchmarks: [...benchmarks].sort(),
    /* What was renamed on the way in, so the grid's columns can be audited
     * against the pages they were read from. */
    labelling: [...renames].map(([change, evidence]) => ({ change, evidence })),
    sources,
    rows: [...rows.values()].sort((a, b) => a.model.localeCompare(b.model)),
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(grid, null, 2)}\n`, 'utf8')

  /* --- what we ended up with ---------------------------------------------- */

  console.log('sources:')
  for (const s of sources) {
    const dropped = s.dropped ? `  (${s.dropped} rival claims dropped)` : ''
    console.log(
      `  ${s.kind.padEnd(14)} ${s.name.padEnd(28)} ${String(s.records).padStart(4)}${dropped}`,
    )
  }

  if (grid.labelling.length > 0) {
    console.log('')
    console.log('labels resolved:')
    for (const { change } of grid.labelling) console.log(`  ${change}`)
  }

  const withClaims = grid.rows.filter((r) => r.claims.some((c) => c.kind === 'claimed'))
  const withMeasured = grid.rows.filter((r) => r.claims.some((c) => c.kind === 'measured'))
  /* Facts only a maker publishes: cutoff dates, output limits. Prices arrive
   * from the marketplaces and are counted separately. */
  const withSpecs = grid.rows.filter((r) => r.knowledgeCutoff ?? r.maxOutputTokens)

  console.log('')
  console.log(`  models      ${grid.rows.length}`)
  console.log(`  benchmarks  ${grid.benchmarks.length}  (${grid.benchmarks.join(', ')})`)
  console.log(`  self-reported ${withClaims.length}`)
  console.log(`  independently measured ${withMeasured.length}`)
  console.log(`  maker specs ${withSpecs.length}`)
  const families = new Set(grid.rows.map((r) => r.family))

  /* The point of the whole exercise: a lab's figure and an outsider's figure
   * for the same model on the same test, side by side. */
  const checked = new Set<string>()
  for (const r of grid.rows) {
    for (const c of r.claims) {
      if (c.kind !== 'claimed') continue
      const sameTest = grid.rows
        .filter((o) => o.family === r.family)
        .flatMap((o) => o.claims)
        .some((o) => o.kind === 'measured' && o.benchmark === c.benchmark)
      if (sameTest) checked.add(`${r.family} ${c.benchmark}`)
    }
  }

  console.log(`  families    ${families.size}`)
  console.log(`  lab claims an outsider also ran  ${checked.size}`)
  console.log(`  dated       ${dated}  (${grid.rows.filter((r) => r.released).length} from the maker)`)
  console.log(`  priced      ${priced}`)
  console.log(
    `  human baselines ${humans.length} on ${new Set(humans.map((h) => h.benchmark)).size} benchmarks`,
  )

  console.log(`  written to  ${OUT}`)
}

main()
