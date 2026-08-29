import type { Benchmark, BillingMode, Price, Provenance, SourceReport } from '../src/types'

/**
 * Where the numbers come from.
 *
 * Each source returns what it found and says whether it worked. Nothing here
 * ever guesses: a source that cannot be read reports the failure and returns
 * nothing, so the collector can keep yesterday's figures rather than publish a
 * confident-looking blank. Someone picks a model on these numbers and spends
 * money, so a wrong figure is worse than a missing one.
 */

const now = (): string => new Date().toISOString()

/**
 * Reads the billing mode out of an id.
 *
 * OpenRouter encodes it as a suffix — `:batch`, `:free`, `:extended`. Treating
 * those as ordinary prices is how a batch rate ends up quoted as the price of
 * a real-time model.
 */
function modeOf(id: string, input: number, output: number): BillingMode {
  const colon = id.indexOf(':')
  if (colon !== -1) {
    const suffix = id.slice(colon + 1).toLowerCase()
    if (suffix.includes('batch')) return 'batch'
    if (suffix.includes('free')) return 'free'
    return 'other'
  }
  /* A genuinely zero price is a free tier however it is labelled: rate limited,
   * and not something to recommend as "the cheapest". */
  if (input === 0 && output === 0) return 'free'
  return 'standard'
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'best-llm-for collector (+https://github.com/super-squalo/best-llm-for)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/* --- OpenRouter: what every reseller charges ------------------------------ */

interface OpenRouterModel {
  id: string
  name: string
  created?: number
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
}

export interface PriceRow {
  modelId: string
  name: string
  context?: number
  /**
   * The day OpenRouter began listing the model, ISO 8601 date.
   *
   * Not the launch date, and not called one: it is a routing marketplace
   * adding an endpoint, usually within days of the announcement and
   * occasionally much later. It is the only machine-readable date covering
   * nearly every model, which makes it the right thing to sort generations by
   * and the wrong thing to quote as "released".
   */
  listedAt?: string
  price: Price
  provenance: Provenance
}

export async function fromOpenRouter(): Promise<{
  rows: PriceRow[]
  report: SourceReport
}> {
  const url = 'https://openrouter.ai/api/v1/models'
  const provenance: Provenance = { source: 'OpenRouter', url, fetchedAt: now() }

  try {
    const body = await getJson<{ data: OpenRouterModel[] }>(url)
    const rows: PriceRow[] = []

    for (const m of body.data ?? []) {
      /* Prices arrive as dollars per token, as strings. Anything unparseable
       * is skipped rather than coerced to zero — a free-looking model that
       * is not free is exactly the wrong answer. */
      const input = Number(m.pricing?.prompt)
      const output = Number(m.pricing?.completion)
      if (!Number.isFinite(input) || !Number.isFinite(output)) continue

      const [vendor] = m.id.split('/')

      rows.push({
        modelId: m.id,
        name: m.name ?? m.id,
        context: m.context_length,
        listedAt: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : undefined,
        price: {
          input: input * 1_000_000,
          output: output * 1_000_000,
          vendor: vendor ?? 'unknown',
          mode: modeOf(m.id, input, output),
        },
        provenance,
      })
    }

    return { rows, report: { name: 'OpenRouter', url, ok: true, records: rows.length } }
  } catch (error) {
    return {
      rows: [],
      report: {
        name: 'OpenRouter',
        url,
        ok: false,
        records: 0,
        error: (error as Error).message,
      },
    }
  }
}

/* --- LiteLLM: first-party list prices ------------------------------------- */

interface LiteLLMEntry {
  input_cost_per_token?: number
  output_cost_per_token?: number
  max_input_tokens?: number
  litellm_provider?: string
}

export async function fromLiteLLM(): Promise<{
  rows: PriceRow[]
  report: SourceReport
}> {
  const url =
    'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
  const provenance: Provenance = { source: 'LiteLLM', url, fetchedAt: now() }

  try {
    const body = await getJson<Record<string, LiteLLMEntry>>(url)
    const rows: PriceRow[] = []

    for (const [id, entry] of Object.entries(body)) {
      if (id === 'sample_spec') continue

      const input = entry.input_cost_per_token
      const output = entry.output_cost_per_token
      if (typeof input !== 'number' || typeof output !== 'number') continue

      rows.push({
        modelId: id,
        name: id,
        context: entry.max_input_tokens,
        price: {
          input: input * 1_000_000,
          output: output * 1_000_000,
          vendor: entry.litellm_provider ?? 'unknown',
          mode: modeOf(id, input, output),
        },
        provenance,
      })
    }

    return { rows, report: { name: 'LiteLLM', url, ok: true, records: rows.length } }
  } catch (error) {
    return {
      rows: [],
      report: {
        name: 'LiteLLM',
        url,
        ok: false,
        records: 0,
        error: (error as Error).message,
      },
    }
  }
}

/* --- Arena: how models actually rank at coding ---------------------------- */

interface ArenaRow {
  model?: string
  score?: number
  votes?: number
  rank?: number
  context?: string
  model2?: string
}

export interface BenchmarkRow {
  modelId: string
  maker?: string
  benchmark: Benchmark
}

/**
 * Coding rankings, read from a published dataset rather than scraped directly.
 *
 * Someone else already publishes this as a dataset, refreshed daily, and using
 * their copy costs the leaderboard no traffic. It also means one stranger's
 * upload is a single point of failure — which is why every figure carries its
 * source, and why the collector keeps the previous file when this returns
 * nothing.
 */
export async function fromArena(): Promise<{
  rows: BenchmarkRow[]
  report: SourceReport
}> {
  const url =
    'https://huggingface.co/datasets/mondk/arena.ai-code-leaderboard-scraped/resolve/main/data.jsonl'
  const provenance: Provenance = {
    source: 'arena.ai coding leaderboard',
    url,
    fetchedAt: now(),
  }

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'best-llm-for collector (+https://github.com/super-squalo/best-llm-for)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const text = await res.text()
    const rows: BenchmarkRow[] = []

    for (const line of text.split('\n')) {
      if (!line.trim()) continue

      let row: ArenaRow
      try {
        row = JSON.parse(line) as ArenaRow
      } catch {
        continue /* one malformed line should not lose the rest */
      }

      if (!row.model || typeof row.score !== 'number') continue

      /* `model2` holds "Anthropic · Proprietary" — the maker is the first half. */
      const maker = row.model2?.split('·')[0]?.trim()

      rows.push({
        modelId: row.model,
        maker: maker || undefined,
        benchmark: {
          name: 'arena-code',
          kind: 'voted',
          score: row.score,
          rank: typeof row.rank === 'number' ? row.rank : undefined,
          /* votes come in thousands, e.g. 8.116 meaning 8,116 */
          sample: typeof row.votes === 'number' ? Math.round(row.votes * 1000) : undefined,
          provenance,
        },
      })
    }

    if (rows.length === 0) throw new Error('parsed no rows — the format may have changed')

    return {
      rows,
      report: { name: 'arena.ai coding leaderboard', url, ok: true, records: rows.length },
    }
  } catch (error) {
    return {
      rows: [],
      report: {
        name: 'arena.ai coding leaderboard',
        url,
        ok: false,
        records: 0,
        error: (error as Error).message,
      },
    }
  }
}
