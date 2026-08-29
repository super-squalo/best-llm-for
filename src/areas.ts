/**
 * Six things people actually pick a model for.
 *
 * A hundred and fifty benchmark names is a list, not an answer. Nobody wakes
 * up wanting to know a model's MMStar score; they want to know whether it can
 * write code, read a screenshot, follow a video, do the maths, hold an argument
 * together, or drive a tool without falling over.
 *
 * So every benchmark belongs to exactly one area, and the table is read one
 * area at a time. What this deliberately does not do is average an area into a
 * single mark: the benchmarks inside one measure different things on different
 * scales, and a mean of them would be a number no one published and no one
 * could check. The area picks the columns. The scores stay the scores.
 */

export interface Area {
  key: string
  /** What it is called on the page and in the CLI. */
  label: string
  /** One line saying what the area is for. */
  blurb: string
  match: RegExp
}

/**
 * Order matters: the first match wins.
 *
 * Vision comes before code and maths on purpose. `MathVista` is a maths test
 * given as pictures — a model fails it by not seeing the diagram, not by not
 * knowing algebra — and `LiveBench/python` is code however much it looks like
 * a language task. Ties like these are the whole reason the order is written
 * down rather than left to whichever rule happened to run first.
 */
export const AREAS: Area[] = [
  {
    key: 'immagini',
    label: 'Images',
    blurb: 'Reading a screenshot, a chart, a scanned page, a diagram.',
    match:
      /mmbench|mmmu|mathvista|ocr|ai2d|mmstar|hallusion|mmvet|realworldqa|vqa|chart|omnidoc|perception|vision|blink|seedbench|image|babyvision/i,
  },
  {
    key: 'video',
    label: 'Video',
    blurb: 'Following something that moves, over minutes rather than one frame.',
    match: /video|mmvu/i,
  },
  {
    key: 'codice',
    label: 'Code',
    blurb: 'Writing it, editing a real repository, making the tests pass.',
    match:
      /code|swe|aider|program|repo|terminal|humaneval|mbpp|multipl|coder|qoder|react|svg|scicode|deepswe|livecodebench|codeforces|python|javascript|typescript/i,
  },
  {
    key: 'agenti',
    label: 'Agents',
    blurb: 'Using tools, browsing, driving a computer to finish a job.',
    match:
      /agent|tool|mcp|browse|automation|osworld|workspace|android|office|spreadsheet|apex|coworker|saas|job|research|search|wide/i,
  },
  {
    key: 'matematica',
    label: 'Maths',
    blurb: 'Competition problems, proofs, arithmetic that has to be exact.',
    match: /math|aime|amps|olympiad|integral|usamo|cnmo|simplify|comp\b|zebra|logic|puzzle/i,
  },
  {
    key: 'ragionamento',
    label: 'Reasoning & knowledge',
    blurb: 'Hard questions, long documents, staying factual under pressure.',
    match: /.*/,
  },
]

/** Which area a benchmark belongs to. Everything lands somewhere. */
export function areaOf(benchmark: string): Area {
  return AREAS.find((a) => a.match.test(benchmark)) ?? (AREAS[AREAS.length - 1] as Area)
}

/**
 * Runs where the model was given help.
 *
 * `Video-MME-With-Subtitles` lets it read instead of watch; `HLE w/ tools`
 * lets it search instead of know. Both are legitimate measurements of a
 * legitimate way to use a model, and both are the wrong thing to lead an area
 * with: the assisted number is always the higher one, and a reader skimming
 * the first column would take it for the model's own ability.
 */
export function assisted(benchmark: string): boolean {
  return /with-subtitles|w\/ ?tools|w\. ?subs?|with tools/i.test(benchmark)
}

/**
 * Benchmarks where a lower score is the better one.
 *
 * Two of them, and they are the reason a table must never be sorted blindly:
 * ranked like everything else, the model that makes things up most often
 * appears at the top of the list.
 */
export function lowerIsBetter(benchmark: string): boolean {
  return benchmark === 'Hallucination-Rate'
}
