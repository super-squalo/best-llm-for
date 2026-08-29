import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AREAS, areaOf, assisted, lowerIsBetter } from '../src/areas'
import type { Claim, GridRow, HumanBaseline } from './grid'

/**
 * The grid as a page, written once a day as plain HTML.
 *
 * Read one area at a time — code, images, video, agents, maths, reasoning —
 * because a hundred and fifty benchmark columns is a spreadsheet and nobody
 * chooses a model out of a spreadsheet. Switching area swaps the columns; it
 * never averages them into a mark, because the benchmarks inside an area
 * measure different things on different scales and their mean would be a
 * number no one published and no one could check.
 *
 * Everything is inline and there is no framework. The whole table is in the
 * markup rather than fetched, so it works without JavaScript and for anything
 * that indexes pages; the script only shows, hides and reorders what is
 * already there.
 */

const here = dirname(fileURLToPath(import.meta.url))
const GRID = join(here, '..', 'data', 'grid.json')
const OUT = join(here, '..', 'site', 'index.html')

/** How many benchmark columns one area gets. */
const PER_AREA = 5

/** The area the page opens on: the widest covered, and the reason for the tool. */
const OPENING = 'codice'

interface Grid {
  generatedAt: string
  humans: HumanBaseline[]
  benchmarks: string[]
  labelling: { change: string; evidence?: string }[]
  sources: { name: string; kind: string; records: number; dropped?: number; url: string }[]
  rows: GridRow[]
}

const escape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

const money = (n: number | undefined): string =>
  n === undefined ? '' : n === 0 ? 'free' : `$${n.toFixed(2)}`

/** How many models carry a figure for each benchmark. */
function coverage(rows: GridRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const name of new Set(row.claims.map((c) => c.benchmark))) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * The models the page is really about: on sale within the last eighteen months.
 *
 * Used to rank columns. Ranking over everything would fill the code area with
 * HumanEval and MBPP — real numbers, published about 2024 open-weight
 * releases, answering a question nobody is asking today.
 */
function current(rows: GridRow[]): GridRow[] {
  const cutoff = new Date(Date.now() - 18 * 30 * 86_400_000).toISOString().slice(0, 10)
  const recent = rows.filter((r) => (r.listedAt ?? '') >= cutoff)
  return recent.length >= 20 ? recent : rows
}

interface Column {
  benchmark: string
  area: string
  models: number
}

/**
 * The columns each area opens with: its widest-covered benchmarks.
 *
 * A column measured on four models is a column of blanks, and one source's
 * twenty-three task columns would crowd out every other view of the same area
 * — so a benchmark family gets at most two of an area's five slots.
 */
function columnsFor(rows: GridRow[], area: string): Column[] {
  const now = coverage(current(rows))
  const all = coverage(rows)

  /**
   * Coverage, weighted towards models on sale now.
   *
   * Counting only current models would hand the video area to a benchmark one
   * lab mentioned once, since almost nothing measured on video is sold through
   * a price feed. Counting every model would hand the code area to HumanEval,
   * answered mostly about 2024 releases. Five to one keeps current models
   * decisive without letting a single row win a column.
   */
  const weight = (benchmark: string): number =>
    (now.get(benchmark) ?? 0) * 5 + (all.get(benchmark) ?? 0)

  const ranked = [...all]
    .filter(([name]) => areaOf(name).key === area)
    .sort(
      (a, b) =>
        /* Neither an assisted run nor a backwards one leads an area: the
         * first column is the one people read as "the score". */
        Number(assisted(a[0])) - Number(assisted(b[0])) ||
        Number(lowerIsBetter(a[0])) - Number(lowerIsBetter(b[0])) ||
        weight(b[0]) - weight(a[0]) ||
        a[0].length - b[0].length ||
        a[0].localeCompare(b[0]),
    )

  const perFamily = new Map<string, number>()
  const chosen: Column[] = []

  for (const [benchmark, models] of ranked) {
    const family = benchmark.includes('/')
      ? (benchmark.split('/')[0] as string)
      : benchmark.replace(/[-\s](Plus|First-Try|unspecified|With-Subtitles)$/, '')
    const used = perFamily.get(family) ?? 0
    if (used >= 2) continue

    perFamily.set(family, used + 1)
    chosen.push({ benchmark, area, models })
    if (chosen.length === PER_AREA) break
  }

  return chosen
}

/**
 * The column an area is sorted by when it opens.
 *
 * Its widest-covered benchmark, skipping the ones where a lower score is the
 * better one — a table that opens with the worst model on top teaches people
 * to misread every other column on the page.
 */
function leadOf(columns: Column[]): string | undefined {
  const plain = columns.find((c) => !lowerIsBetter(c.benchmark) && !assisted(c.benchmark))
  return (plain ?? columns.find((c) => !lowerIsBetter(c.benchmark)))?.benchmark
}

/** The figure a cell shows, and everything needed to check it. */
function cell(row: GridRow, column: Column): string {
  const claims = row.claims.filter((c) => c.benchmark === column.benchmark)
  const classes = ['n', `c-${column.area}`]

  if (claims.length === 0) return `<td class="${classes.join(' ')}"></td>`

  /* When a lab and an outsider both ran it, the outsider's figure leads: it is
   * the one nobody had a reason to flatter. Both are kept in the tooltip. */
  const measured = claims.find((c) => c.kind === 'measured')
  const shown = measured ?? (claims[0] as Claim)

  const title = claims
    .map(
      (c) =>
        `${c.kind === 'measured' ? 'measured by' : 'claimed by'} ${c.by} · ${c.score} · ${c.capturedAt}${c.reportedAs ? ` · published as "${c.reportedAs}"` : ''}`,
    )
    .join('\n')

  classes.push(shown.kind === 'measured' ? 'measured' : 'claimed')
  if (measured && claims.some((c) => c.kind === 'claimed')) classes.push('checked')

  /* One decimal on the page, the published figure in the tooltip. LiveBench
   * prints 86.957 and nobody picks a model on the third decimal, but the
   * number as published is what a reader would check against the source. */
  const value = Math.abs(shown.score) >= 100 ? Math.round(shown.score) : shown.score.toFixed(1)

  return `<td class="${classes.join(' ')}" title="${escape(title)}"><a href="${escape(shown.source)}" rel="nofollow">${value}</a></td>`
}

/**
 * The line for people, pinned above the models.
 *
 * It sits outside the sortable body because it is not a competitor: each of
 * these figures was produced by a different method — one medallist on twenty
 * problems, four hundred volunteers on a puzzle set, an estimate from a
 * professional exam's 95th percentile — and letting it sort into the ranking
 * would invite reading it as one more model's score.
 */
function humanRow(humans: HumanBaseline[], columns: Column[]): string {
  const best = new Map<string, HumanBaseline>()
  for (const h of humans) {
    /* Where a benchmark has two baselines — the expert and the passer-by — the
     * higher one is pinned and the other rides along in the tooltip. */
    const seen = best.get(h.benchmark)
    if (!seen || h.score > seen.score) best.set(h.benchmark, h)
  }

  const cells = columns
    .map((c) => {
      const all = humans.filter((h) => h.benchmark === c.benchmark)
      const top = best.get(c.benchmark)
      if (!top) return `<td class="n c-${c.area}"></td>`

      const title = all.map((h) => `${h.score} — ${h.who}\n${h.quote}`).join('\n\n')

      return `<td class="n human c-${c.area}" title="${escape(title)}"><a href="${escape(top.source)}" rel="nofollow">${top.score.toFixed(1)}</a></td>`
    })
    .join('')

  return `<tr class="humans">
<th scope="row" title="Published human baselines. Each one was measured its own way — read the cell.">People</th>
<td class="d"></td><td class="n p"></td><td class="n p"></td>
${cells}</tr>`
}

/** Which areas this model has any score in — the row hides itself elsewhere. */
function areasOf(row: GridRow, columns: Column[]): string[] {
  const names = new Set(row.claims.map((c) => c.benchmark))
  return [...new Set(columns.filter((c) => names.has(c.benchmark)).map((c) => c.area))]
}

/**
 * The maker's name, unless the model's own name already carries it.
 *
 * Some leaderboards publish `Gemini 1.5 Pro Google`, affiliation and all. The
 * name is left as published — trimming what looks like a lab name is how
 * `Kimi K2 Moonshot` quietly becomes a model called `Kimi K2 Moon` — but
 * printing the badge next to it would say Google twice.
 */
function maker(row: GridRow): string {
  if (!row.maker) return ''
  if (row.model.toLowerCase().includes(row.maker.toLowerCase())) return ''
  return `<span class="mk">${escape(row.maker)}</span>`
}

function tableRow(row: GridRow, columns: Column[]): string {
  const cells = columns.map((c) => cell(row, c)).join('')
  const areas = areasOf(row, columns)

  return `<tr data-model="${escape(`${row.model} ${row.maker ?? ''}`.toLowerCase())}" data-areas="${areas.join(' ')}" data-priced="${row.priceInput === undefined ? '0' : '1'}">
<th scope="row" title="${escape(row.model)}"><span class="m">${escape(row.model)}</span>${maker(row)}</th>
<td class="d">${row.listedAt?.slice(0, 7) ?? ''}</td>
<td class="n p">${money(row.priceInput)}</td>
<td class="n p">${money(row.priceOutput)}</td>
${cells}</tr>`
}

/**
 * Rows worth putting on a page, in the order they open in.
 *
 * A model with one score and no price is a row of empty cells: real, kept in
 * the data, and noise in a table. What is left opens sorted by the first
 * area's lead column, and the page says underneath how many rows it held back.
 */
function worthShowing(rows: GridRow[], columns: Column[], lead?: string): GridRow[] {
  const inView = (r: GridRow): number =>
    r.claims.filter((c) => columns.some((col) => col.benchmark === c.benchmark)).length

  const shown = rows.filter((r) => inView(r) >= 2 || (inView(r) >= 1 && r.priceInput !== undefined))

  /* A model nobody ran on the lead benchmark sorts below every model that was
   * run, rather than counting as a zero: not measured and measured badly are
   * different facts and a table must not confuse them. */
  const leadScore = (r: GridRow): number | null => {
    if (!lead) return null
    const claims = r.claims.filter((c) => c.benchmark === lead)
    if (claims.length === 0) return null
    return (claims.find((c) => c.kind === 'measured') ?? claims[0])?.score ?? null
  }

  return shown.sort((a, b) => {
    const x = leadScore(a)
    const y = leadScore(b)
    if (x !== null && y !== null && x !== y) return y - x
    if (x !== null && y === null) return -1
    if (x === null && y !== null) return 1
    return (
      inView(b) - inView(a) ||
      (b.listedAt ?? '').localeCompare(a.listedAt ?? '') ||
      a.model.localeCompare(b.model)
    )
  })
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #0d0f12;
  --panel: #14171c;
  --line: #232830;
  --ink: #e7ebf0;
  --soft: #8b949e;
  --accent: #7ee787;
  --claim: #d29922;
  --link: #79c0ff;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.55 var(--mono);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1400px; margin: 0 auto; padding: 0 20px; }

header { border-bottom: 1px solid var(--line); padding: 52px 0 26px; }
h1 { margin: 0; font-size: 30px; letter-spacing: -0.02em; }
h1 span { color: var(--soft); font-weight: 400; }
.lede { margin: 14px 0 0; max-width: 62ch; color: var(--soft); font-size: 15px; }
.lede strong { color: var(--ink); font-weight: 600; }
.counts { display: flex; flex-wrap: wrap; gap: 26px; margin: 24px 0 0; padding: 0; list-style: none; }
.counts b { display: block; font-size: 25px; color: var(--accent); font-weight: 600; }
.counts span { color: var(--soft); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
.install { margin: 20px 0 0; padding: 11px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 7px; display: inline-block; }
.install::before { content: "$ "; color: var(--accent); }

.areas { display: flex; flex-wrap: wrap; gap: 8px; padding: 22px 0 0; }
.areas button {
  font: inherit; font-size: 14px; cursor: pointer; color: var(--soft);
  background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 7px 15px;
}
.areas button:hover { color: var(--ink); }
.areas button[aria-pressed="true"] { color: var(--bg); background: var(--accent); border-color: var(--accent); font-weight: 600; }
.areas button b { font-weight: inherit; }
.areas button i { font-style: normal; opacity: 0.65; margin-left: 7px; font-size: 12px; }
.blurb { margin: 12px 0 0; color: var(--soft); font-size: 14px; }

.controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 14px 0; }
input[type=search] {
  font: inherit; font-size: 14px; color: var(--ink); background: var(--panel);
  border: 1px solid var(--line); border-radius: 6px; padding: 7px 11px; min-width: 230px;
}
label.check { color: var(--soft); font-size: 13px; display: flex; align-items: center; gap: 7px; cursor: pointer; }
.legend { margin-left: auto; color: var(--soft); font-size: 12px; display: flex; gap: 16px; flex-wrap: wrap; }
.legend i { font-style: normal; }
.legend .measured::before, .legend .claimed::before {
  content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px;
}
.legend .measured::before { background: var(--accent); }
.legend .claimed::before { background: var(--claim); }

.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); }
table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }
thead th {
  position: sticky; top: 0; z-index: 2; background: var(--panel);
  text-align: right; font-weight: 500; color: var(--soft); white-space: nowrap;
  padding: 11px 10px; border-bottom: 1px solid var(--line); font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.06em;
}
thead th:first-child { text-align: left; left: 0; z-index: 3; }
thead th[data-dir] { color: var(--ink); }
thead th[data-dir="desc"]::after { content: " ↓"; }
thead th[data-dir="asc"]::after { content: " ↑"; }
tbody th {
  position: sticky; left: 0; z-index: 1; background: var(--panel);
  text-align: left; font-weight: 400; padding: 5px 12px 5px 14px; white-space: nowrap;
  border-bottom: 1px solid var(--line); border-right: 1px solid var(--line);
  max-width: 270px; overflow: hidden; text-overflow: ellipsis;
}
tbody th .mk { color: var(--soft); font-size: 11px; margin-left: 8px; }
tbody td { padding: 5px 10px; text-align: right; border-bottom: 1px solid var(--line); white-space: nowrap; }
tbody tr:hover th, tbody tr:hover td { background: #191d24; }
td.n a { color: inherit; }
td.measured { color: var(--accent); }
td.claimed { color: var(--claim); }
td.checked { font-weight: 600; text-decoration: underline dotted var(--soft) 1px; text-underline-offset: 3px; }
td.d, td.p { color: var(--soft); }
tr.humans th, tr.humans td { background: var(--panel); border-bottom: 2px solid var(--line); font-weight: 600; }
tr.humans th { color: var(--ink); }
tr.humans td.human { color: var(--ink); }
tr.humans td.human a { color: inherit; }
.note { padding: 14px 2px 0; color: var(--soft); font-size: 13px; max-width: 90ch; }

section { padding: 42px 0 0; }
h2 { font-size: 17px; margin: 0 0 12px; }
p, li { color: var(--soft); max-width: 74ch; }
.rules { padding-left: 18px; }
.rules strong { color: var(--ink); font-weight: 600; }
.src { width: 100%; font-size: 13px; margin-top: 6px; }
.src td, .src th { padding: 6px 10px 6px 0; text-align: left; border-bottom: 1px solid var(--line); color: var(--soft); }
.src th { color: var(--ink); font-weight: 500; }
.src td:last-child { text-align: right; }
footer { margin-top: 50px; padding: 22px 0 60px; border-top: 1px solid var(--line); color: var(--soft); font-size: 12px; }

@media (prefers-color-scheme: light) {
  :root {
    --bg: #fbfbfa; --panel: #fff; --line: #e3e4e8; --ink: #16181d;
    --soft: #6a7280; --accent: #1a7f37; --claim: #9a6700; --link: #0a58ca;
  }
  tbody tr:hover th, tbody tr:hover td { background: #f4f5f7; }
  .areas button[aria-pressed="true"] { color: #fff; }
}
@media (max-width: 640px) {
  header { padding-top: 32px; }
  h1 { font-size: 23px; }
  .legend { margin-left: 0; }
}
`

const SCRIPT = `
const table = document.querySelector('table');
const body = table.querySelector('tbody');
const rows = [...body.querySelectorAll('tr:not(.humans)')];
const q = document.getElementById('q');
const priced = document.getElementById('priced');
const count = document.getElementById('count');
const blurb = document.getElementById('blurb');
const LEADS = JSON.parse(document.getElementById('leads').textContent);
const BLURBS = JSON.parse(document.getElementById('blurbs').textContent);

let area = table.dataset.area;

function apply() {
  const term = q.value.trim().toLowerCase();
  const onlyPriced = priced.checked;
  let shown = 0;

  for (const row of rows) {
    /* A model with nothing measured in this area has no business being on
       screen while that area is open: it would read as a row of failures. */
    const inArea = row.dataset.areas.split(' ').includes(area);
    const hit = inArea && (!term || row.dataset.model.includes(term)) && (!onlyPriced || row.dataset.priced === '1');
    row.hidden = !hit;
    if (hit) shown++;
  }
  count.textContent = shown;
}

function sortBy(header, descending) {
  const column = Number(header.dataset.col);
  for (const h of table.querySelectorAll('thead th[data-dir]')) delete h.dataset.dir;
  header.dataset.dir = descending ? 'desc' : 'asc';

  const value = (row) => {
    const text = row.children[column].textContent.replace('$', '').trim();
    const n = Number(text);
    return text === '' ? null : Number.isFinite(n) ? n : text;
  };

  rows.sort((a, b) => {
    const x = value(a), y = value(b);
    /* A blank cell means nobody ran that test. It sorts to the bottom either
       way, rather than counting as a zero and looking like a bad score. */
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === 'string' || typeof y === 'string') {
      return descending ? String(y).localeCompare(String(x)) : String(x).localeCompare(String(y));
    }
    return descending ? y - x : x - y;
  });
  for (const row of rows) body.appendChild(row);
}

document.querySelectorAll('thead th[data-col]').forEach((header) => {
  header.style.cursor = 'pointer';
  header.title = 'Sort by this column';
  header.addEventListener('click', () => sortBy(header, header.dataset.dir !== 'desc'));
});

document.querySelectorAll('.areas button').forEach((button) => {
  button.addEventListener('click', () => {
    area = button.dataset.area;
    table.dataset.area = area;
    for (const other of document.querySelectorAll('.areas button')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    blurb.textContent = BLURBS[area];

    const lead = LEADS[area];
    const header = lead && table.querySelector('thead th[data-benchmark="' + CSS.escape(lead) + '"]');
    if (header) sortBy(header, true);
    apply();
  });
});

q.addEventListener('input', apply);
priced.addEventListener('change', apply);
apply();
`

function main(): void {
  const grid = JSON.parse(readFileSync(GRID, 'utf8')) as Grid

  const byArea = new Map(AREAS.map((a) => [a.key, columnsFor(grid.rows, a.key)]))
  const columns = AREAS.flatMap((a) => byArea.get(a.key) ?? [])
  const leads = Object.fromEntries(AREAS.map((a) => [a.key, leadOf(byArea.get(a.key) ?? []) ?? '']))
  const blurbs = Object.fromEntries(AREAS.map((a) => [a.key, a.blurb]))

  const shown = worthShowing(grid.rows, columns, leads[OPENING])

  const measured = grid.rows.filter((r) => r.claims.some((c) => c.kind === 'measured')).length
  const independent = grid.sources.filter((s) => s.kind === 'independent').length
  const dropped = grid.sources.reduce((total, s) => total + (s.dropped ?? 0), 0)

  const areaButtons = AREAS.map((a) => {
    const models = shown.filter((r) => areasOf(r, byArea.get(a.key) ?? []).length > 0).length
    return `<button data-area="${a.key}" aria-pressed="${a.key === OPENING}"><b>${escape(a.label)}</b><i>${models}</i></button>`
  }).join('\n    ')

  const head = columns
    .map(
      (c, i) =>
        `<th class="c-${c.area}" data-col="${i + 4}" data-benchmark="${escape(c.benchmark)}"${c.benchmark === leads[OPENING] ? ' data-dir="desc"' : ''} title="${c.models} models${lowerIsBetter(c.benchmark) ? ' · lower is better' : ''}">${escape(c.benchmark)}</th>`,
    )
    .join('\n      ')

  /* One rule per area, so a column only shows while its area is open. */
  const areaCss = AREAS.map(
    (a) => `table[data-area="${a.key}"] .c-${a.key} { display: table-cell; }`,
  ).join('\n')

  const sourceRows = grid.sources
    .map(
      (s) =>
        `<tr><th><a href="${escape(s.url)}" rel="nofollow">${escape(s.name)}</a></th><td>${escape(s.kind)}</td><td>${s.records} kept${s.dropped ? ` · ${s.dropped} rival claims dropped` : ''}</td></tr>`,
    )
    .join('\n        ')

  const labelling = grid.labelling
    .map(
      (l) =>
        `<li><code>${escape(l.change)}</code>${l.evidence ? ` — ${escape(l.evidence)}` : ''}</li>`,
    )
    .join('\n          ')

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>best-llm-for — every model, every benchmark, one table with sources</title>
<meta name="description" content="Language models compared on code, images, video, agents, maths and reasoning. Every number links to the page it was published on, and a lab's claim about its own model is never mixed with an outsider's measurement.">
<meta property="og:title" content="best-llm-for">
<meta property="og:description" content="One table for every model and every benchmark, by area. Every number carries its source.">
<meta property="og:type" content="website">
<style>
${STYLE}
/* Columns belong to one area and appear only while that area is open. */
td[class*="c-"], th[class*="c-"] { display: none; }
${areaCss}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>best-llm-for <span>— the whole table</span></h1>
  <p class="lede">Every lab publishes the slice that flatters it, on its own page, under its own
  spelling of the benchmark's name. This puts them in one grid, one area at a time:
  <strong>every number links to the page it came from</strong>, and a lab's claim about its own
  model is never mixed with an outsider's measurement of it.</p>
  <ul class="counts">
    <li><b>${grid.rows.length}</b><span>models</span></li>
    <li><b>${grid.benchmarks.length}</b><span>benchmarks</span></li>
    <li><b>${grid.sources.length}</b><span>sources</span></li>
    <li><b>${measured}</b><span>independently measured</span></li>
    <li><b>${dropped}</b><span>rival claims dropped</span></li>
  </ul>
  <p class="install">npx best-llm-for</p>
</header>

<div class="areas">
    ${areaButtons}
</div>
<p class="blurb" id="blurb">${escape(AREAS.find((a) => a.key === OPENING)?.blurb ?? '')}</p>

<div class="controls">
  <input type="search" id="q" placeholder="filter models — opus, qwen, mini…" aria-label="Filter models">
  <label class="check"><input type="checkbox" id="priced"> only models you can buy today</label>
  <span class="legend">
    <i class="measured">measured by an outsider</i>
    <i class="claimed">the lab's own figure</i>
    <i>underlined = both, and they can be compared</i>
  </span>
</div>

<div class="scroll">
<table data-area="${OPENING}">
  <thead>
    <tr>
      <th>Model</th>
      <th data-col="1">Since</th>
      <th data-col="2">In /1M</th>
      <th data-col="3">Out /1M</th>
      ${head}
    </tr>
  </thead>
  <tbody>
${humanRow(grid.humans ?? [], columns)}
${shown.map((r) => tableRow(r, columns)).join('\n')}
  </tbody>
</table>
</div>
<p class="note"><span id="count">${shown.length}</span> models in this area.
${grid.rows.length - shown.length} more are in the data with too few scores to line up here.
No area is averaged into a single mark: the benchmarks inside one measure different things on
different scales, and their mean would be a number nobody published and nobody could check.</p>

<section>
  <h2>What this does with a number before showing it</h2>
  <ul class="rules">
    <li><strong>A lab's figures for its rivals are thrown away.</strong> ${dropped} claims dropped on
    the last build. Launch tables set a new model against whatever the competition shipped a year
    ago; nobody picks a rival's best run to stand next to.</li>
    <li><strong>A rename has to bring evidence.</strong> OpenAI's <code>GPQA</code> column is filed
    under <code>GPQA-Diamond</code> because <code>gpqa_eval.py</code> defaults to the Diamond subset
    — the code says so. Where the evidence runs out, the score gets its own
    <code>-unspecified</code> column instead of a guess.</li>
    <li><strong>Claimed and measured never merge.</strong> A lab marking its own homework and an
    outsider checking it are different kinds of evidence. Both are shown; the gap between them is
    the interesting part.</li>
    <li><strong>Settings are not models.</strong> <code>-high</code> and <code>-max</code> are the
    same weights thinking for longer, so they keep separate rows and share a price and a date.</li>
  </ul>
</section>

<section>
  <h2>Labels resolved, and why</h2>
  <ul class="rules">
          ${labelling}
  </ul>
</section>

<section>
  <h2>Sources</h2>
  <p>${independent} of these run the tests themselves. The rest are labs reporting on their own models.</p>
  <table class="src">
    <tbody>
        ${sourceRows}
    </tbody>
  </table>
</section>

<footer>
  Rebuilt ${grid.generatedAt.slice(0, 10)}. Prices and listing dates from OpenRouter and LiteLLM;
  scores from the pages linked in every cell. No affiliate links, nothing sponsored, no model paid
  to be here.
</footer>

</div>
<script type="application/json" id="leads">${JSON.stringify(leads)}</script>
<script type="application/json" id="blurbs">${JSON.stringify(blurbs)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, html, 'utf8')

  for (const a of AREAS) {
    const cols = byArea.get(a.key) ?? []
    console.log(`  ${a.label.padEnd(22)} ${cols.map((c) => c.benchmark).join(', ')}`)
  }
  console.log(`  ${shown.length} rows, ${columns.length} columns across ${AREAS.length} areas`)
  console.log(`  written to  ${OUT}`)
}

main()
