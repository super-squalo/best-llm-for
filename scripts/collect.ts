import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { familyOf } from '../src/identity'
import type { Benchmark, Dataset, Model, SourceReport } from '../src/types'
import { fromArena, fromLiteLLM, fromOpenRouter } from './sources'

/**
 * Assembles one file out of several leaderboards and price lists.
 *
 * Two things behave differently here, and getting them the same way round is
 * the whole point:
 *
 * **Benchmarks are permanent.** Once a model has been measured, that figure is
 * what it is — a new run months later might refine it, but nothing about the
 * model changes. So scores accumulate: whatever has been captured is kept
 * forever, and a source going dark costs only future models, never the
 * archive. That turns the weakest link into the strongest asset.
 *
 * **Prices are not.** Vendors cut them, resellers appear, promotions land.
 * Those are replaced on every run, because a stale price sends someone to pay
 * more than they needed to.
 *
 * The other job is noticing what is *new*. A model appearing in a price feed
 * is the earliest public sign it exists at all, and being first to say what it
 * costs and how good it is beats being complete about models everyone already
 * knows.
 */

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'data', 'models.json')

/** Strips the vendor prefix and settles on lower case. Nothing else. */
function normaliseId(raw: string): string {
  const withoutVendor = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw
  return withoutVendor.toLowerCase().trim()
}

/**
 * Whether this exact reading is already on record.
 *
 * The score has to be part of the comparison. A leaderboard can list the same
 * model twice — different harnesses, different runs — and matching on name and
 * source alone finds the first of those, decides the second is a change, and
 * appends it again on every single run. The archive then grows forever without
 * learning anything.
 */
function alreadyRecorded(model: Model, candidate: Benchmark): boolean {
  return model.benchmarks.some(
    (b) =>
      b.name === candidate.name &&
      b.provenance.source === candidate.provenance.source &&
      b.score === candidate.score,
  )
}

async function main(): Promise<void> {
  const runAt = new Date().toISOString()
  const sources: SourceReport[] = []

  /* --- what we already know ---------------------------------------------- */

  let previous: Dataset | null = null
  try {
    previous = JSON.parse(readFileSync(OUT, 'utf8')) as Dataset
  } catch {
    /* first run */
  }

  const byId = new Map<string, Model>()
  for (const m of previous?.models ?? []) {
    /* Prices are dropped: this run fetches them fresh. Scores are kept. */
    byId.set(m.id, { ...m, prices: [] })
  }
  const knownBefore = new Set(byId.keys())

  const upsert = (id: string, seed: Partial<Model>): Model => {
    const key = normaliseId(id)
    const existing = byId.get(key)
    if (existing) {
      if (!existing.maker && seed.maker) existing.maker = seed.maker
      if (!existing.context && seed.context) existing.context = seed.context
      /* Earliest listing wins: a model relisted under a new alias did not come
       * out again on the day the alias appeared. */
      if (seed.listedAt && (!existing.listedAt || seed.listedAt < existing.listedAt)) {
        existing.listedAt = seed.listedAt
      }
      return existing
    }
    const created: Model = {
      id: key,
      firstSeen: runAt,
      name: seed.name ?? key,
      maker: seed.maker,
      context: seed.context,
      listedAt: seed.listedAt,
      prices: [],
      benchmarks: [],
    }
    byId.set(key, created)
    return created
  }

  /* --- prices: replaced every run ---------------------------------------- */

  const openrouter = await fromOpenRouter()
  sources.push(openrouter.report)
  for (const row of openrouter.rows) {
    upsert(row.modelId, {
      name: row.name,
      context: row.context,
      listedAt: row.listedAt,
    }).prices.push(row.price)
  }

  const litellm = await fromLiteLLM()
  sources.push(litellm.report)
  for (const row of litellm.rows) {
    const model = upsert(row.modelId, { name: row.name, context: row.context })
    const already = model.prices.some(
      (p) =>
        p.vendor === row.price.vendor &&
        p.input === row.price.input &&
        p.output === row.price.output,
    )
    if (!already) model.prices.push(row.price)
  }

  /* --- benchmarks: added, never replaced ---------------------------------- */

  const arena = await fromArena()
  sources.push(arena.report)

  let newScores = 0
  for (const row of arena.rows) {
    const model = upsert(row.modelId, { maker: row.maker })

    /* A reading already on file is left alone. A genuinely different score
     * from the same source means the benchmark was re-run, and both readings
     * are kept so the change is visible rather than silently overwritten. */
    if (alreadyRecorded(model, row.benchmark)) continue

    model.benchmarks.push(row.benchmark)
    newScores++
  }

  /* --- variants inherit the family's real prices -------------------------- */

  const priced = new Map<string, Model[]>()
  for (const m of byId.values()) {
    if (m.prices.length === 0) continue
    const family = familyOf(m.id)
    priced.set(family, [...(priced.get(family) ?? []), m])
  }

  for (const m of byId.values()) {
    if (m.prices.length > 0) continue
    const siblings = priced.get(familyOf(m.id))
    if (!siblings?.length) continue

    /* Standard rates only. A batch price borrowed from a sibling would be
     * quoted as this variant's price, and buys a different product. */
    const usable = siblings.flatMap((s) => s.prices).filter((p) => p.mode === 'standard')
    if (usable.length > 0) m.prices = usable
  }

  /* --- dates borrowed the same way ---------------------------------------- */

  /* Leaderboards score `claude-opus-5-high` and `claude-opus-5-max`; the price
   * feed lists `claude-opus-5`. One model at two effort settings did not come
   * out on two different days, so the family's earliest listing is this
   * variant's date too. Without it the SINCE column is empty on exactly the
   * rows worth dating — the ones with scores. */
  const listedByFamily = new Map<string, string>()
  for (const m of byId.values()) {
    if (!m.listedAt) continue
    const family = familyOf(m.id)
    const seen = listedByFamily.get(family)
    if (!seen || m.listedAt < seen) listedByFamily.set(family, m.listedAt)
  }

  for (const m of byId.values()) {
    if (m.listedAt) continue
    const inherited = listedByFamily.get(familyOf(m.id))
    if (inherited) m.listedAt = inherited
  }

  /* --- refuse to publish something worse than what is already there ------- */

  const failed = sources.filter((s) => !s.ok)
  if (failed.length === sources.length) {
    console.error('Every source failed. Keeping the existing file.')
    for (const s of failed) console.error(`  ${s.name}: ${s.error}`)
    process.exit(1)
  }

  const models = [...byId.values()].filter(
    (m) => m.benchmarks.length > 0 || m.prices.length > 0,
  )

  const scoredNow = models.filter((m) => m.benchmarks.length > 0).length
  const scoredBefore = previous?.models.filter((m) => m.benchmarks.length > 0).length ?? 0

  if (previous && scoredNow < scoredBefore) {
    console.error(
      `Scores went backwards: ${scoredBefore} before, ${scoredNow} now. ` +
        'Benchmarks only ever accumulate, so this means a source misbehaved. Keeping the existing file.',
    )
    for (const s of failed) console.error(`  ${s.name}: ${s.error}`)
    process.exit(1)
  }

  const newModels = models
    .filter((m) => !knownBefore.has(m.id))
    .map((m) => m.id)
    .sort()

  const dataset: Dataset = {
    generatedAt: runAt,
    sources,
    newModels,
    models: models.sort((a, b) => a.id.localeCompare(b.id)),
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')

  /* --- what happened ------------------------------------------------------ */

  console.log('sources:')
  for (const s of sources) {
    console.log(
      `  ${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(30)} ${String(s.records).padStart(5)}${s.error ? `  ${s.error}` : ''}`,
    )
  }

  console.log('')
  console.log(`  models        ${models.length}`)
  console.log(`  with a score  ${scoredNow}${scoredBefore ? ` (was ${scoredBefore})` : ''}`)
  console.log(`  new scores    ${newScores}`)

  if (newModels.length > 0) {
    console.log('')
    console.log(`  NEW MODELS (${newModels.length}):`)
    for (const id of newModels.slice(0, 20)) console.log(`    ${id}`)
    if (newModels.length > 20) console.log(`    ... and ${newModels.length - 20} more`)
  } else if (previous) {
    console.log('  no new models')
  }
}

main().catch((error: unknown) => {
  console.error('collector failed:', (error as Error).message)
  process.exit(1)
})
