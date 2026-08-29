import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What each lab claims, taken from the page the lab publishes it on.
 *
 * Open-weight labs ship a model card with a real benchmark table in it. That
 * is the primary document — the same file the weights come with, versioned in
 * public, dated, and citable. Everything here reads those tables and writes
 * them down unchanged.
 *
 * Every column is imported, including the rival columns a launch table always
 * carries. They are dropped later, in `grid.ts`, by the rule that a score
 * counts only when the lab that published it also built the model: doing it
 * there rather than here keeps one rule in one place, and makes the count of
 * discarded rival claims visible in the build output instead of silent.
 *
 * Cards that publish their numbers as images — Meta's, Mistral's — cannot be
 * read this way, and are left out rather than transcribed by eye into
 * something that looks machine-collected.
 */

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(here, '..', 'data', 'benchmarks')

const UA = 'which-llm collector (+https://github.com/super-squalo/which-llm)'

interface CardConfig {
  /** Output filename under `data/benchmarks/`. */
  file: string
  /** Hugging Face repo id, e.g. `zai-org/GLM-5.3`. */
  repo: string
  /** Whose card this is — used as `reportedBy` for every column on it. */
  lab: string
  /** Name for the set, shown in the build report. */
  set: string
  note: string
}

const CARDS: CardConfig[] = [
  {
    file: 'deepseek-v4.json',
    repo: 'deepseek-ai/DeepSeek-V4-Pro-0813',
    lab: 'DeepSeek',
    set: 'deepseek-v4-model-card',
    note: 'DeepSeek publishes a markdown benchmark table in the model card shipped with the weights.',
  },
  {
    file: 'zhipu-glm.json',
    repo: 'zai-org/GLM-5.3',
    lab: 'Zhipu',
    set: 'glm-5.3-model-card',
    note: 'Z.ai publishes a markdown benchmark table in the GLM model card.',
  },
  {
    file: 'qwen.json',
    repo: 'Qwen/Qwen3.8-2.4T-A95B',
    lab: 'Alibaba',
    set: 'qwen3.8-model-card',
    note: 'Qwen publishes its benchmark table as HTML inside the model card.',
  },
  {
    file: 'moonshot-k3.json',
    repo: 'moonshotai/Kimi-K3',
    lab: 'Moonshot',
    set: 'kimi-k3-model-card',
    note: 'Moonshot publishes its benchmark table as HTML inside the model card.',
  },
]

interface BenchmarkFile {
  benchmarkSet: string
  note: string
  source: string
  capturedAt: string
  benchmarks: string[]
  entries: {
    model: string
    reportedBy: string
    source: string
    scores: Record<string, number>
  }[]
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

/** Tags out, entities and whitespace tidied, nothing else touched. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A table as rows of cells, however the card happened to write it. */
type Table = string[][]

function htmlTables(card: string): Table[] {
  const tables: Table[] = []
  for (const block of card.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (block.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
      (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(text),
    )
    if (rows.length > 1) tables.push(rows)
  }
  return tables
}

function markdownTables(card: string): Table[] {
  const tables: Table[] = []
  let current: Table = []

  for (const line of card.split('\n')) {
    if (line.trim().startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim())
      /* `|---|:--:|` is the rule under the header, not a row. */
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue
      current.push(cells)
      continue
    }
    if (current.length > 1) tables.push(current)
    current = []
  }
  if (current.length > 1) tables.push(current)

  return tables
}

/**
 * A score, or nothing.
 *
 * Cards mark the winner in bold, write a missing run as a dash, and sometimes
 * put two figures in one cell — DeepSeek's `42.7 / 60.0` is the same benchmark
 * with and without tools. A pair like that is two different conditions and
 * there is no way to tell from the table which column heading covers which, so
 * the cell is skipped rather than half-read.
 */
function score(cell: string): number | null {
  const cleaned = cell.replace(/\*\*/g, '').replace(/%/g, '').trim()
  if (cleaned.includes('/')) return null
  if (cleaned === '' || /^[-–—]$/.test(cleaned) || cleaned.toUpperCase() === 'N/A') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Which table on the card holds the benchmark results.
 *
 * Cards carry other tables — parameter counts, layer widths, licence terms.
 * The results table is the one with several columns of numbers under model
 * names, so it is picked by shape rather than by position, which survives a
 * lab reordering its own page.
 */
function resultsTable(tables: Table[]): Table | null {
  let best: { table: Table; numbers: number } | null = null

  for (const table of tables) {
    const [header, ...rows] = table
    if (!header || header.length < 3) continue

    const numbers = rows.reduce(
      (total, row) => total + row.slice(1).filter((c) => score(c) !== null).length,
      0,
    )
    if (numbers < 6) continue
    if (!best || numbers > best.numbers) best = { table, numbers }
  }

  return best?.table ?? null
}

async function readCard(config: CardConfig): Promise<BenchmarkFile> {
  const source = `https://huggingface.co/${config.repo}`
  const card = await getText(`${source}/raw/main/README.md`)

  const table = resultsTable([...markdownTables(card), ...htmlTables(card)])
  if (!table) throw new Error('no benchmark table found on the card')

  const [header, ...rows] = table
  const models = (header ?? []).slice(1)

  /* One bag of scores per column, filled row by row. */
  const scores = models.map(() => new Map<string, number>())
  const benchmarks = new Set<string>()

  for (const row of rows) {
    const [label, ...cells] = row
    /* A single-cell row is a section heading: `Coding Agent`, `Reasoning`. */
    if (!label || cells.length === 0) continue

    cells.forEach((cell, i) => {
      const value = score(cell)
      if (value === null) return
      scores[i]?.set(label, value)
      benchmarks.add(label)
    })
  }

  const entries = models
    .map((model, i) => ({
      model,
      reportedBy: config.lab,
      source,
      scores: Object.fromEntries(scores[i] ?? []),
    }))
    .filter((e) => model_is_named(e.model) && Object.keys(e.scores).length > 0)

  if (entries.length === 0) throw new Error('table found but no scores parsed')

  return {
    benchmarkSet: config.set,
    note: config.note,
    source,
    capturedAt: new Date().toISOString().slice(0, 10),
    benchmarks: [...benchmarks],
    entries,
  }
}

/** Guards against an empty or decorative column heading becoming a model. */
function model_is_named(name: string): boolean {
  return name.trim().length > 1 && /[a-z]/i.test(name)
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  let failed = 0

  for (const config of CARDS) {
    try {
      const data = await readCard(config)
      writeFileSync(join(OUT_DIR, config.file), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      console.log(
        `  ok   ${config.set.padEnd(24)} ${String(data.entries.length).padStart(3)} columns  ${data.benchmarks.length} benchmarks`,
      )
    } catch (error) {
      failed++
      console.error(
        `  FAIL ${config.set.padEnd(24)} ${(error as Error).message}  (keeping existing file)`,
      )
    }
  }

  if (failed === CARDS.length) {
    console.error('Every model card failed.')
    process.exit(1)
  }
}

main().catch((error: unknown) => {
  console.error('card reader failed:', (error as Error).message)
  process.exit(1)
})
