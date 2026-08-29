import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Scores from people who did not build the model.
 *
 * A lab's own table is a claim; someone else running the same test is a check
 * on it. The grid keeps both and marks which is which, and the gap between
 * them is often the most useful number on the row.
 *
 * These four run their own evaluations and publish machine-readable results,
 * which is rarer than it sounds — most leaderboards are a web page with the
 * numbers baked into a bundle. Each writes one file into `data/independent/`
 * and nothing here interprets a score: labels are renamed only in
 * `benchmarks.ts`, where a rename has to bring its evidence.
 */

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(here, '..', 'data', 'independent')

const UA = 'which-llm collector (+https://github.com/supersqualoyt/which-llm)'

interface IndependentFile {
  benchmarkSet: string
  kind: 'independent'
  source: string
  note?: string
  capturedAt: string
  benchmarks: string[]
  entries: {
    model: string
    measuredBy: string
    source: string
    scores: Record<string, number | null>
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

const today = (): string => new Date().toISOString().slice(0, 10)

/** A percentage written any of the ways these pages write it. */
function num(raw: string): number | null {
  const cleaned = raw.replace('%', '').trim()
  if (cleaned === '' || cleaned === '-' || cleaned === 'N/A') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/* --- Vectara: hallucination, measured on a fixed set of documents --------- */

const VECTARA = 'https://github.com/vectara/hallucination-leaderboard'
const VECTARA_RAW =
  'https://raw.githubusercontent.com/vectara/hallucination-leaderboard/main/README.md'

async function vectara(): Promise<IndependentFile> {
  const md = await getText(VECTARA_RAW)
  const entries: IndependentFile['entries'] = []

  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    /* `|a|b|` splits to ['', 'a', 'b', ''] — the ends are the pipes. */
    const [, model, rate, consistency] = cells
    if (!model || model === 'Model' || model.startsWith('---')) continue

    const hallucination = num(rate ?? '')
    if (hallucination === null) continue

    entries.push({
      model,
      measuredBy: 'Vectara',
      source: VECTARA,
      scores: {
        'Hallucination-Rate': hallucination,
        'Factual-Consistency': num(consistency ?? ''),
      },
    })
  }

  return {
    benchmarkSet: 'vectara-hallucination',
    kind: 'independent',
    source: VECTARA,
    note: 'Measured by Vectara, not self-reported. Lower hallucination rate is better.',
    capturedAt: today(),
    benchmarks: ['Hallucination-Rate', 'Factual-Consistency'],
    entries,
  }
}

/* --- Aider: can the model edit a real repository until the tests pass ----- */

const AIDER = 'https://aider.chat/docs/leaderboards/'
const AIDER_RAW =
  'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml'

/**
 * The polyglot leaderboard, read straight out of Aider's data file.
 *
 * It is YAML, but a flat list of `key: value` under `- dirname:` entries, so a
 * line reader handles it without pulling in a parser for one file.
 *
 * `pass_rate_2` is the headline: the share of 225 exercises solved within two
 * attempts. `pass_rate_1` is the first-try figure and a different question, so
 * both are kept apart rather than averaged. Where a model was run more than
 * once, the best pass_rate_2 stands — reruns here are configuration changes,
 * not repeats of the same setup.
 */
async function aiderPolyglot(): Promise<IndependentFile> {
  const yml = await getText(AIDER_RAW)
  const best = new Map<string, { pass1: number | null; pass2: number; format?: string }>()

  let model: string | undefined
  let pass1: number | null = null
  let pass2: number | null = null
  let format: string | undefined

  const flush = (): void => {
    if (model && pass2 !== null) {
      const seen = best.get(model)
      if (!seen || pass2 > seen.pass2) best.set(model, { pass1, pass2, format })
    }
    model = undefined
    pass1 = null
    pass2 = null
    format = undefined
  }

  for (const line of yml.split('\n')) {
    if (line.startsWith('- dirname:')) {
      flush()
      continue
    }
    const match = /^\s+(\w+):\s*(.*)$/.exec(line)
    if (!match) continue
    const [, field, rawValue] = match
    const value = (rawValue ?? '').replace(/^["']|["']$/g, '').trim()

    if (field === 'model') model = value
    else if (field === 'pass_rate_1') pass1 = num(value)
    else if (field === 'pass_rate_2') pass2 = num(value)
    else if (field === 'edit_format') format = value
  }
  flush()

  return {
    benchmarkSet: 'aider-polyglot',
    kind: 'independent',
    source: AIDER,
    note: '225 exercises in six languages, run by Aider. Pass rate 2 allows a second attempt after seeing the test output, which is how the tool is actually used.',
    capturedAt: today(),
    benchmarks: ['Aider-Polyglot', 'Aider-Polyglot-First-Try'],
    entries: [...best].map(([name, r]) => ({
      model: name,
      measuredBy: 'Aider',
      source: AIDER,
      scores: { 'Aider-Polyglot': r.pass2, 'Aider-Polyglot-First-Try': r.pass1 },
    })),
  }
}

/* --- EvalPlus: HumanEval and MBPP with the missing tests added ------------ */

const EVALPLUS = 'https://evalplus.github.io/leaderboard.html'
const EVALPLUS_RAW = 'https://raw.githubusercontent.com/evalplus/evalplus.github.io/main/results.json'

/**
 * Why the `+` columns matter more than the originals.
 *
 * HumanEval ships with about eight tests per problem, few enough that wrong
 * solutions pass. EvalPlus adds roughly eighty times more, reruns every model,
 * and publishes both — so the pair shows how much of a headline HumanEval
 * score survives being tested properly. That is a check on the number labs
 * quote, produced by someone with nothing riding on it.
 */
async function evalplus(): Promise<IndependentFile> {
  const raw = await getText(EVALPLUS_RAW)
  const data = JSON.parse(raw) as Record<
    string,
    { 'pass@1'?: Record<string, number>; prompted?: boolean }
  >

  const entries: IndependentFile['entries'] = []
  for (const [model, record] of Object.entries(data)) {
    const p = record['pass@1']
    if (!p) continue
    entries.push({
      model,
      measuredBy: 'EvalPlus',
      source: EVALPLUS,
      scores: {
        HumanEval: p['humaneval'] ?? null,
        'HumanEval-Plus': p['humaneval+'] ?? null,
        MBPP: p['mbpp'] ?? null,
        'MBPP-Plus': p['mbpp+'] ?? null,
      },
    })
  }

  return {
    benchmarkSet: 'evalplus',
    kind: 'independent',
    source: EVALPLUS,
    note: 'EvalPlus reruns HumanEval and MBPP with roughly 80x more tests. The plain columns are their own rerun of the original tests, not the labs figures.',
    capturedAt: today(),
    benchmarks: ['HumanEval', 'HumanEval-Plus', 'MBPP', 'MBPP-Plus'],
    entries,
  }
}

/* --- LiveBench: questions written after the models were trained ----------- */

const LIVEBENCH = 'https://livebench.ai/'

/**
 * LiveBench publishes one CSV per release, named by date, and nothing that
 * lists which dates exist. The site's own bundle holds the dates it offers, so
 * they are read from there and tried newest first.
 */
async function livebenchLatest(): Promise<{ url: string; csv: string }> {
  const index = await getText(LIVEBENCH)
  const bundle = /src="\.?(\/?static\/js\/[^"]+\.js)"/.exec(index)?.[1]

  const dates = new Set<string>()
  if (bundle) {
    const js = await getText(new URL(bundle, LIVEBENCH).toString())
    for (const m of js.matchAll(/20\d{2}-\d{2}-\d{2}/g)) dates.add(m[0])
  }

  /* Newest first, and only a handful of attempts: this is a fallback path, not
   * a crawl of someone else's site. */
  const candidates = [...dates].sort().reverse().slice(0, 12)

  for (const date of candidates) {
    const url = `${LIVEBENCH}table_${date.replace(/-/g, '_')}.csv`
    try {
      const csv = await getText(url)
      if (csv.startsWith('model,')) return { url, csv }
    } catch {
      /* That release has no published table. Try the one before it. */
    }
  }

  throw new Error('no published LiveBench table found')
}

/**
 * Every task kept separate, and no LiveBench average computed.
 *
 * The site shows a global average built from six categories, but the published
 * CSV is task-level and the task-to-category mapping is not in anything
 * fetchable. Averaging the columns by hand would produce a number that looks
 * like LiveBench's headline and is not it. So each task is its own column,
 * grouped under `LiveBench/` — real measurements, none of them invented.
 */
async function livebench(): Promise<IndependentFile> {
  const { url, csv } = await livebenchLatest()
  const [header, ...lines] = csv.trim().split('\n')
  const columns = (header ?? '').split(',').map((c) => c.trim())
  const tasks = columns.slice(1)
  const benchmarks = tasks.map((t) => `LiveBench/${t}`)

  const entries: IndependentFile['entries'] = []
  for (const line of lines) {
    const cells = line.split(',')
    const model = cells[0]?.trim()
    if (!model) continue

    const scores: Record<string, number | null> = {}
    tasks.forEach((task, i) => {
      scores[`LiveBench/${task}`] = num(cells[i + 1] ?? '')
    })
    entries.push({ model, measuredBy: 'LiveBench', source: LIVEBENCH, scores })
  }

  return {
    benchmarkSet: 'livebench',
    kind: 'independent',
    source: url,
    note: 'Questions are written after the models are released, so no model can have seen them in training. Task-level scores only: LiveBench computes its headline average from a task-to-category mapping that is not published in machine-readable form, and guessing it would fake their number.',
    capturedAt: today(),
    benchmarks,
    entries,
  }
}


/* --- OpenVLM: what a model can see --------------------------------------- */

const OPENVLM = 'https://huggingface.co/spaces/opencompass/open_vlm_leaderboard'
const OPENVLM_RAW = 'http://opencompass.openxlab.space/assets/OpenVLM.json'

/**
 * The vision benchmarks, run by OpenCompass rather than by the labs.
 *
 * Text leaderboards say nothing about whether a model can read a chart, a
 * receipt or a diagram, which is most of what people actually paste into one.
 * This is the only source found that publishes those results for hundreds of
 * models in a machine-readable file, and it runs the tests itself.
 *
 * Only the headline of each benchmark is kept. Every one of these also
 * publishes a breakdown by question type, and a grid with forty columns per
 * benchmark is a spreadsheet, not an answer.
 */
const VLM_BENCHMARKS: [string, string][] = [
  ['MMBench_TEST_EN_V11', 'MMBench-EN'],
  ['MMMU_VAL', 'MMMU'],
  ['MathVista', 'MathVista'],
  ['OCRBench', 'OCRBench'],
  ['AI2D', 'AI2D'],
  ['MMStar', 'MMStar'],
  ['HallusionBench', 'HallusionBench'],
  ['MMVet', 'MMVet'],
  ['RealWorldQA', 'RealWorldQA'],
]

async function openvlm(): Promise<IndependentFile> {
  const raw = await getText(OPENVLM_RAW)
  const data = JSON.parse(raw) as {
    time: string
    results: Record<string, Record<string, { Overall?: number | string } | unknown>>
  }

  const entries: IndependentFile['entries'] = []

  for (const [model, record] of Object.entries(data.results)) {
    const scores: Record<string, number | null> = {}
    let any = false

    for (const [key, name] of VLM_BENCHMARKS) {
      const overall = (record[key] as { Overall?: number | string } | undefined)?.Overall
      const value = typeof overall === 'number' ? overall : num(String(overall ?? ''))
      scores[name] = value
      if (value !== null) any = true
    }
    if (!any) continue

    entries.push({ model, measuredBy: 'OpenCompass', source: OPENVLM, scores })
  }

  /* Their file stamps itself `20250917132916`. Read as a date rather than
   * stamped with today: claiming today's date for someone else's year-old run
   * would make it look fresher than it is. */
  const stamp = data.time ?? ''
  const capturedAt = /^\d{8}/.test(stamp)
    ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
    : today()

  return {
    benchmarkSet: 'openvlm',
    kind: 'independent',
    source: OPENVLM,
    note: 'Vision benchmarks run by OpenCompass with VLMEvalKit, not by the labs. Headline score of each benchmark only.',
    capturedAt,
    benchmarks: VLM_BENCHMARKS.map(([, name]) => name),
    entries,
  }
}

/* --- Video-MME: what a model can follow over time ------------------------- */

const VIDEOMME = 'https://video-mme.github.io/home_page.html'

/**
 * The video leaderboard, read off the page the authors maintain.
 *
 * Two figures per model and they are not interchangeable: with subtitles the
 * model can read its way to the answer, without them it has to watch. Both are
 * kept, because a model that collapses when the subtitles are removed is a
 * useful thing to know about before pointing it at video.
 *
 * The model column also carries the lab's name — `Gemini 1.5 Pro Google` — and
 * it is left exactly as published. Trimming what looks like an affiliation is
 * how `Kimi K2 Moonshot` quietly becomes a model called `Kimi K2 Moon`.
 */
async function videoMme(): Promise<IndependentFile> {
  const html = await getText(VIDEOMME)

  const strip = (cell: string): string =>
    cell.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

  const rows = (html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
    (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(strip),
  )

  const entries: IndependentFile['entries'] = []

  for (const cells of rows) {
    /* Data rows carry rank, model, params, frames, date, then the scores. */
    if (cells.length < 7) continue
    const model = cells[1]
    const withoutSubs = num(cells[5] ?? '')
    if (!model || model === 'Model' || withoutSubs === null) continue

    entries.push({
      model,
      measuredBy: 'Video-MME',
      source: VIDEOMME,
      scores: {
        'Video-MME': withoutSubs,
        'Video-MME-With-Subtitles': num(cells[6] ?? ''),
      },
    })
  }

  return {
    benchmarkSet: 'video-mme',
    kind: 'independent',
    source: VIDEOMME,
    note: '900 videos from a few seconds to an hour. The plain score is without subtitles - the model has to watch rather than read.',
    capturedAt: today(),
    benchmarks: ['Video-MME', 'Video-MME-With-Subtitles'],
    entries,
  }
}

/* --- run them all -------------------------------------------------------- */


const SOURCES: [string, () => Promise<IndependentFile>][] = [
  ['vectara.json', vectara],
  ['aider-polyglot.json', aiderPolyglot],
  ['evalplus.json', evalplus],
  ['livebench.json', livebench],
  ['openvlm.json', openvlm],
  ['video-mme.json', videoMme],
]

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  let failed = 0

  for (const [file, fetchOne] of SOURCES) {
    try {
      const data = await fetchOne()
      if (data.entries.length === 0) throw new Error('no entries parsed')

      /* Written only on success: a source that changed shape overnight leaves
       * yesterday's file in place rather than emptying the grid. */
      writeFileSync(join(OUT_DIR, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      console.log(
        `  ok   ${data.benchmarkSet.padEnd(22)} ${String(data.entries.length).padStart(4)} models  ${data.benchmarks.length} benchmarks`,
      )
    } catch (error) {
      failed++
      console.error(`  FAIL ${file.padEnd(22)} ${(error as Error).message}  (keeping existing file)`)
    }
  }

  if (failed === SOURCES.length) {
    console.error('Every independent source failed.')
    process.exit(1)
  }
}

main().catch((error: unknown) => {
  console.error('independent collector failed:', (error as Error).message)
  process.exit(1)
})
