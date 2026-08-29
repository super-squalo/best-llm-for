#!/usr/bin/env node
import { AREAS, areaOf, assisted, lowerIsBetter } from './areas'
import { load } from './data'
import { coverage, findBenchmarks, humansOn, loadGrid, onBenchmark, rowsForModel } from './grid'
import type { Grid, GridRow } from './grid'
import { latestScore, rank, recentlyAdded, search, usablePrice, variantsOf } from './index'
import type { Ranked } from './index'
import type { Benchmark, Loaded, Model } from './types'

/**
 * The whole point: answering "which model, and what does it cost" without
 * leaving the terminal. The websites that hold this data are fine — they are
 * just somewhere else, and you are here.
 */

const BOLD = '[1m'
const DIM = '[2m'
const OFF = '[0m'

const colour = process.stdout.isTTY && !process.env['NO_COLOR']
const bold = (s: string): string => (colour ? `${BOLD}${s}${OFF}` : s)
const dim = (s: string): string => (colour ? `${DIM}${s}${OFF}` : s)

/**
 * Thousands separated the same way everywhere.
 *
 * Bare toLocaleString follows the machine's locale, so the same command prints
 * 1,048,576 on one laptop and 1.048.576 on another. Documentation, issue
 * reports and screenshots should not depend on where the reader lives.
 */
const thousands = (n: number): string => n.toLocaleString('en-US')

const money = (n: number): string => (n === 0 ? 'free' : `$${n.toFixed(2)}`)

function help(): void {
  console.log(`
${bold('best-llm-for')} — which model is strongest right now, and what it costs

  npx best-llm-for                     top models for coding
  npx best-llm-for --budget 1          only what costs $1 or less per million in
  npx best-llm-for --new               models that turned up in the last two weeks
  npx best-llm-for opus 5              everything known about one model
  npx best-llm-for --area images       one area: code, images, video, agents, maths, reasoning
  npx best-llm-for --on gpqa           every model ranked on one benchmark, people included
  npx best-llm-for --scores opus 5     every published score for one model
  npx best-llm-for --benchmarks        every benchmark, grouped by area

Options
  --area <name>   code, images, video, agents, maths, reasoning
  --on <name>     rank on one benchmark: gpqa, aider, swe-bench, livebench
  --scores        every score on record for a model, with who published it
  --benchmarks    list the benchmarks, widest coverage first
  --budget <n>    ceiling on input price, dollars per million tokens
  --out <n>       ceiling on output price
  --limit <n>     how many rows (default 15)
  --all           include models nobody sells yet
  --batch         count batch pricing as a real price
  --refresh       ignore the local cache
  --json          machine-readable output
  --help

Two kinds of figure appear, and they are never mixed:

  ${bold('measured')}  a test was run — the code either passed or it did not
  ${bold('voted')}     people compared two answers blind and picked one

A model can be technically right and unpleasant to work with, or the reverse,
so averaging those into one number would hide the thing you came to find out.

In the benchmark grid the same rule applies to who did the measuring:

  ${bold('measured')}  an outsider ran the test
  ${bold('claimed')}   the lab that built the model published the figure

A lab's numbers about its rivals are thrown away entirely: launch tables pick
the generation of the competition that makes the launch look best.

Where someone has published what people score on the same test, a ${bold('PEOPLE')} line
sits in the ranking where it falls. It always says which people — a medallist,
a PhD student, four hundred volunteers — because "humans score 90" is not a
fact about anyone.
`)
}

/* --- arguments ------------------------------------------------------------ */

interface Args {
  words: string[]
  area?: string
  on?: string
  scores: boolean
  benchmarks: boolean
  budget?: number
  out?: number
  limit: number
  all: boolean
  batch: boolean
  refresh: boolean
  json: boolean
  fresh: boolean
  help: boolean
}

function parse(argv: string[]): Args {
  const args: Args = {
    words: [],
    scores: false,
    benchmarks: false,
    limit: 15,
    all: false,
    batch: false,
    refresh: false,
    json: false,
    fresh: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a) continue

    const numeric = (): number | undefined => {
      const next = Number(argv[++i])
      return Number.isFinite(next) ? next : undefined
    }

    switch (a) {
      case '--area':
        args.area = argv[++i]
        break
      case '--on':
        args.on = argv[++i]
        break
      case '--scores':
        args.scores = true
        break
      case '--benchmarks':
        args.benchmarks = true
        break
      case '--budget':
      case '-b':
        args.budget = numeric()
        break
      case '--out':
        args.out = numeric()
        break
      case '--limit':
      case '-n': {
        const n = numeric()
        if (n !== undefined) args.limit = n
        break
      }
      case '--all':
        args.all = true
        break
      case '--batch':
        args.batch = true
        break
      case '--refresh':
        args.refresh = true
        break
      case '--json':
        args.json = true
        break
      case '--new':
        args.fresh = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        if (!a.startsWith('-')) args.words.push(a)
    }
  }

  return args
}

/* --- output --------------------------------------------------------------- */

function footer(loaded: Loaded): string {
  const when =
    loaded.ageHours < 1
      ? 'just now'
      : loaded.ageHours < 48
        ? `${Math.round(loaded.ageHours)}h ago`
        : `${Math.round(loaded.ageHours / 24)} days ago`

  const where =
    loaded.origin === 'bundled'
      ? 'shipped with this version — could not reach the network'
      : loaded.origin === 'cache'
        ? 'cached'
        : 'fetched'

  return dim(`  data ${where}, ${when}`)
}

function table(rows: Ranked[], loaded: Loaded): void {
  if (rows.length === 0) {
    console.log('\n  Nothing matched.\n')
    return
  }

  const widest = Math.min(34, Math.max(...rows.map((r) => r.model.id.length)))

  console.log('')
  console.log(
    `  ${bold('MODEL'.padEnd(widest))}  ${bold('SCORE'.padStart(6))} ${dim('KIND'.padEnd(9))} ${bold('IN/1M'.padStart(8))} ${bold('OUT/1M'.padStart(8))}  ${dim('SINCE'.padEnd(7))} ${dim('VENDORS')}`,
  )

  for (const r of rows) {
    const id = r.model.id.length > widest ? `${r.model.id.slice(0, widest - 1)}…` : r.model.id
    const kind = r.benchmark.kind === 'measured' ? 'measured' : 'voted'
    const price = r.price
      ? `${money(r.price.input).padStart(8)} ${money(r.price.output).padStart(8)}`
      : `${dim('     —')}   ${dim('     —')}`
    const vendors = r.model.prices.length || '-'
    /* Year and month is the useful resolution: it separates generations
     * without implying we know the launch day. */
    const since = r.model.listedAt ? r.model.listedAt.slice(0, 7) : '—'

    console.log(
      `  ${id.padEnd(widest)}  ${String(Math.round(r.benchmark.score)).padStart(6)} ${dim(kind.padEnd(9))} ${price}  ${dim(since.padEnd(7))} ${dim(String(vendors))}`,
    )
  }

  console.log('')
  console.log(footer(loaded))
  console.log('')
}

function detail(model: Model, all: Model[], loaded: Loaded): void {
  console.log('')
  console.log(`  ${bold(model.id)}${model.maker ? dim(`   ${model.maker}`) : ''}`)
  if (model.context) console.log(dim(`  context ${thousands(model.context)} tokens`))
  if (model.listedAt) console.log(dim(`  on sale since ${model.listedAt}   ${dim('(OpenRouter listing)')}`))
  console.log(dim(`  first seen ${model.firstSeen.slice(0, 10)}`))

  if (model.benchmarks.length > 0) {
    console.log('')
    console.log(`  ${bold('SCORES')}`)
    const sorted = [...model.benchmarks].sort((a, b) =>
      b.provenance.fetchedAt.localeCompare(a.provenance.fetchedAt),
    )
    for (const b of sorted) {
      const sample = b.sample ? dim(` from ${thousands(b.sample)} votes`) : ''
      console.log(
        `    ${b.name.padEnd(18)} ${String(Math.round(b.score)).padStart(6)}  ${dim(b.kind)}${sample}`,
      )
      console.log(dim(`      ${b.provenance.source} · read ${b.provenance.fetchedAt.slice(0, 10)}`))
    }
  } else {
    /* The exact id may be unmeasured while its effort variants are not.
     * Answering "no scores" would be true of the id and useless to whoever
     * asked: the leaderboard measures claude-opus-5-max, vendors sell
     * claude-opus-5, and both are the same weights. */
    const variants = variantsOf(all, model)

    if (variants.length > 0) {
      console.log('')
      console.log(`  ${bold('SCORES')} ${dim('measured on the effort variants')}`)
      for (const v of variants) {
        const b = latestScore(v)
        if (!b) continue
        console.log(
          `    ${v.id.padEnd(26)} ${String(Math.round(b.score)).padStart(6)}  ${dim(b.kind)}`,
        )
      }
    } else {
      console.log(dim('\n  No benchmark scores on record yet.'))
    }
  }

  if (model.prices.length > 0) {
    console.log('')
    console.log(`  ${bold('PRICES')} ${dim('per million tokens')}`)
    const sorted = [...model.prices].sort((a, b) => a.input - b.input)
    for (const p of sorted) {
      const mode = p.mode === 'standard' ? '' : dim(`  ${p.mode}`)
      console.log(
        `    ${p.vendor.padEnd(22)} ${money(p.input).padStart(8)} in  ${money(p.output).padStart(8)} out${mode}`,
      )
    }
  } else {
    console.log(dim('\n  Nobody sells this one yet.'))
  }

  console.log('')
  console.log(footer(loaded))
  console.log('')
}


/* --- the benchmark grid --------------------------------------------------- */

const age = (grid: Grid): string => {
  const days = Math.floor((Date.now() - new Date(grid.generatedAt).getTime()) / 86_400_000)
  return days <= 0 ? 'built today' : days === 1 ? 'built yesterday' : `built ${days} days ago`
}

/** Everything that would let someone check a figure, on one line. */
function provenance(kind: string, by: string, capturedAt: string): string {
  return dim(`${kind === 'measured' ? 'measured by' : 'claimed by'} ${by}, read ${capturedAt}`)
}

function benchmarkList(grid: Grid): void {
  const counts = [...coverage(grid)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const widest = Math.min(38, Math.max(...counts.map(([name]) => name.length)))

  /* Grouped by area, because a flat list of a hundred and fifty names is the
   * problem this tool exists to solve, not a way to present it. */
  for (const area of AREAS) {
    const mine = counts.filter(([name, models]) => areaOf(name).key === area.key && models >= 2)
    if (mine.length === 0) continue

    console.log('')
    console.log(`  ${bold(area.label)} ${dim(`— ${area.blurb}`)}`)
    for (const [name, models] of mine) {
      /* One model on a benchmark is a fact about that model, not a comparison,
       * and listing it here would suggest otherwise. */
      console.log(`    ${name.padEnd(widest)}  ${String(models).padStart(5)}${lowerIsBetter(name) ? dim('  lower is better') : ''}`)
    }
  }
  console.log('')
  console.log(dim(`  ${grid.benchmarks.length} benchmarks, ${grid.rows.length} models, ${age(grid)}`))
  console.log(dim('  rank on one with:  best-llm-for --on <name>'))
  console.log('')
}

function benchmarkRanking(grid: Grid, query: string, limit: number): void {
  const matches = findBenchmarks(grid, query)
  const benchmark = matches[0]

  if (!benchmark) {
    console.error(`
  No benchmark matching "${query}". Try: best-llm-for --benchmarks
`)
    process.exit(1)
  }

  const ranked = onBenchmark(grid, benchmark).slice(0, limit)
  const widest = Math.min(34, Math.max(...ranked.map((r) => r.row.model.length)))

  console.log('')
  console.log(`  ${bold(benchmark)}${benchmark === 'Hallucination-Rate' ? dim('   lower is better') : ''}`)
  if (matches.length > 1) {
    console.log(dim(`  also matched: ${matches.slice(1, 5).join(', ')}`))
  }
  console.log('')
  console.log(
    `  ${bold('MODEL'.padEnd(widest))}  ${bold('SCORE'.padStart(7))} ${dim('WHO RAN IT'.padEnd(22))} ${bold('IN/1M'.padStart(8))}  ${dim('LAB SAYS')}`,
  )

  const people = humansOn(grid, benchmark)
  let printed = 0

  for (const { row, claim, alsoClaimed } of ranked) {
    /* Printed in position: seeing where the people sit in the order is the
     * whole value of having them here. */
    while (printed < people.length && (people[printed] as { score: number }).score > claim.score) {
      for (const line of humanLine(grid, benchmark, widest).slice(printed, printed + 1)) {
        console.log(line)
      }
      printed++
    }
    const name = row.model.length > widest ? `${row.model.slice(0, widest - 1)}…` : row.model
    const who = `${claim.kind === 'measured' ? '' : 'self · '}${claim.by}`
    const price = row.priceInput === undefined ? dim('       —') : money(row.priceInput).padStart(8)

    /* The lab's own figure next to the outsider's, when both exist. Nobody
     * needs telling which way that gap usually points. */
    const gap = alsoClaimed
      ? dim(`${alsoClaimed.score} (${alsoClaimed.score > claim.score ? '+' : ''}${(alsoClaimed.score - claim.score).toFixed(1)})`)
      : ''

    console.log(
      `  ${name.padEnd(widest)}  ${claim.score.toFixed(1).padStart(7)} ${dim(who.padEnd(22))} ${price}  ${gap}`,
    )
  }

  /* People who scored below every model shown still get their line: the point
   * of the comparison is where they sit, including at the bottom. */
  for (const line of humanLine(grid, benchmark, widest).slice(printed)) console.log(line)

  console.log('')
  if (people.length === 0) {
    console.log(dim('  Nobody has published a human score for this benchmark.'))
  }
  console.log(dim(`  ${age(grid)} · every figure links to its source in --json`))
  console.log('')
}

function modelScores(grid: Grid, query: string): void {
  const rows = rowsForModel(grid, query)

  if (rows.length === 0) {
    console.error(`
  Nothing matching "${query}" in the benchmark grid.
`)
    process.exit(1)
  }

  for (const row of rows.slice(0, 6)) {
    console.log('')
    console.log(`  ${bold(row.model)}${row.maker ? dim(`   ${row.maker}`) : ''}`)

    const facts = [
      row.listedAt ? `on sale since ${row.listedAt}` : '',
      row.priceInput !== undefined
        ? `${money(row.priceInput)} in / ${money(row.priceOutput ?? 0)} out per 1M`
        : '',
      row.contextTokens ? `${thousands(row.contextTokens)} tokens of context` : '',
    ].filter(Boolean)
    if (facts.length > 0) console.log(dim(`  ${facts.join('  ·  ')}`))

    if (row.claims.length === 0) {
      console.log(dim('\n  No published scores.'))
      continue
    }

    const widest = Math.min(30, Math.max(...row.claims.map((c) => c.benchmark.length)))
    const sorted = [...row.claims].sort(
      (a, b) => a.benchmark.localeCompare(b.benchmark) || a.kind.localeCompare(b.kind),
    )

    console.log('')
    for (const c of sorted) {
      const renamed = c.reportedAs ? dim(`  published as "${c.reportedAs}"`) : ''
      console.log(
        `    ${c.benchmark.padEnd(widest)} ${c.score.toFixed(1).padStart(7)}  ${provenance(c.kind, c.by, c.capturedAt)}${renamed}`,
      )
    }
  }

  if (rows.length > 6) console.log(dim(`
  …and ${rows.length - 6} more variants of this model.`))
  console.log('')
  console.log(dim(`  ${age(grid)}`))
  console.log('')
}


/**
 * One area, its benchmarks, and the models that lead each of them.
 *
 * Deliberately not a ranking of the area. The benchmarks inside one measure
 * different things on different scales, and averaging them would produce a
 * mark nobody published and nobody could check — so this shows each benchmark
 * with its own top of the table, and leaves the judgement where it belongs.
 */
function areaView(grid: Grid, query: string, limit: number): void {
  const q = query.toLowerCase()
  const area =
    AREAS.find((a) => a.key === q || a.label.toLowerCase() === q) ??
    AREAS.find((a) => a.key.startsWith(q) || a.label.toLowerCase().startsWith(q))

  if (!area) {
    console.error(`\n  No area called "${query}". They are: ${AREAS.map((a) => a.label).join(', ')}
`)
    process.exit(1)
  }

  const counts = [...coverage(grid)]
    .filter(([name]) => areaOf(name).key === area.key)
    .filter(([, models]) => models >= 2)
    /* The unassisted run first: with subtitles or with tools the model was
     * given help, the number is always higher, and it should not be the first
     * thing read as the model's own ability. */
    .sort(
      (a, b) =>
        Number(assisted(a[0])) - Number(assisted(b[0])) ||
        Number(lowerIsBetter(a[0])) - Number(lowerIsBetter(b[0])) ||
        b[1] - a[1],
    )

  console.log('')
  console.log(`  ${bold(area.label)}   ${dim(area.blurb)}`)

  if (counts.length === 0) {
    console.log(dim('\n  Nothing in this area has been measured on more than one model yet.\n'))
    return
  }

  for (const [benchmark, models] of counts.slice(0, 6)) {
    const ranked = onBenchmark(grid, benchmark).slice(0, limit)
    const widest = Math.min(32, Math.max(...ranked.map((r) => r.row.model.length)))

    console.log('')
    console.log(
      `  ${bold(benchmark)} ${dim(`${models} models`)}${lowerIsBetter(benchmark) ? dim('   lower is better') : ''}`,
    )

    for (const { row, claim } of ranked) {
      const name = row.model.length > widest ? `${row.model.slice(0, widest - 1)}…` : row.model
      const who = claim.kind === 'measured' ? claim.by : `self · ${claim.by}`
      const price = row.priceInput === undefined ? dim('      —') : money(row.priceInput).padStart(7)
      console.log(`    ${name.padEnd(widest)} ${claim.score.toFixed(1).padStart(7)} ${dim(who.padEnd(14))} ${price}`)
    }
  }

  console.log('')
  console.log(dim(`  ${counts.length} benchmarks in this area · no area is averaged into one mark`))
  console.log(dim(`  ${age(grid)}`))
  console.log('')
}


/**
 * The line for people, printed where it falls in the ranking.
 *
 * The comparison the field started with and mostly stopped printing. It is
 * not a competitor and never sorted as one: each baseline was measured its own
 * way — one medallist on twenty problems, four hundred volunteers on a puzzle
 * set, an estimate from a professional exam — so it says who the people were
 * every time it appears.
 */
function humanLine(grid: Grid, benchmark: string, width: number): string[] {
  return humansOn(grid, benchmark).map(
    (h) =>
      `  ${bold('PEOPLE'.padEnd(width))}  ${bold(h.score.toFixed(1).padStart(7))} ${dim(h.who)}`,
  )
}

/* --- main ----------------------------------------------------------------- */



async function main(): Promise<void> {
  const args = parse(process.argv.slice(2))

  if (args.help) {
    help()
    return
  }

  /* The grid ships in the package and needs no network, so these three answer
   * before anything is fetched. */
  if (args.benchmarks || args.on || args.scores || args.area) {
    const grid = loadGrid()

    if (args.area) {
      if (args.json) {
        const key = args.area.toLowerCase()
        const rows = grid.rows.filter((r) =>
          r.claims.some((c) => areaOf(c.benchmark).key.startsWith(key)),
        )
        console.log(JSON.stringify(rows, null, 2))
        return
      }
      areaView(grid, args.area, Math.min(args.limit, 8))
      return
    }

    if (args.benchmarks) {
      if (args.json) console.log(JSON.stringify({ benchmarks: [...coverage(grid)] }, null, 2))
      else benchmarkList(grid)
      return
    }

    if (args.on) {
      if (args.json) {
        const found = findBenchmarks(grid, args.on)[0]
        console.log(JSON.stringify(found ? onBenchmark(grid, found) : [], null, 2))
        return
      }
      benchmarkRanking(grid, args.on, args.limit)
      return
    }

    const query = args.words.join(' ')
    if (!query) {
      console.error('\n  --scores needs a model: best-llm-for --scores opus 5\n')
      process.exit(1)
    }
    if (args.json) {
      console.log(JSON.stringify(rowsForModel(grid, query), null, 2))
      return
    }
    modelScores(grid, query)
    return
  }

  let loaded: Loaded
  try {
    loaded = await load({ refresh: args.refresh })
  } catch (error) {
    console.error(`\n  ${(error as Error).message}\n`)
    process.exit(1)
  }

  const models = loaded.data.models
  const modes = args.batch ? (['standard', 'batch'] as const) : (['standard'] as const)

  /* One named model: show everything known about it. */
  const query = args.words.filter((w) => w !== 'coding').join(' ')
  if (query) {
    const found = search(models, query)
    if (found.length === 0) {
      console.error(`\n  Nothing matching "${query}".\n`)
      process.exit(1)
    }
    if (args.json) {
      console.log(JSON.stringify(found[0], null, 2))
      return
    }
    detail(found[0] as Model, models, loaded)
    return
  }

  /* What turned up recently. */
  if (args.fresh) {
    const fresh = recentlyAdded(models, 14)
    if (args.json) {
      console.log(JSON.stringify(fresh, null, 2))
      return
    }
    if (fresh.length === 0) {
      console.log('\n  Nothing new in the last two weeks.\n')
      console.log(footer(loaded))
      console.log('')
      return
    }
    const rows: Ranked[] = fresh.map((model) => ({
      model,
      benchmark:
        latestScore(model) ??
        ({
          name: '—',
          kind: 'measured',
          score: 0,
          provenance: { source: '', url: '', fetchedAt: model.firstSeen },
        } as Benchmark),
      price: usablePrice(model, [...modes]),
    }))
    table(rows, loaded)
    return
  }

  const rows = rank(models, {
    maxInput: args.budget,
    maxOutput: args.out,
    modes: [...modes],
    pricedOnly: !args.all,
    limit: args.limit,
  })

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  table(rows, loaded)
}

main().catch((error: unknown) => {
  console.error(`\n  ${(error as Error).message}\n`)
  process.exit(1)
})
