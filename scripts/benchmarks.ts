/**
 * One name per test.
 *
 * Labs do not agree on what to call a benchmark, and worse, two labs sometimes
 * use the same word for different tests. `GPQA` in OpenAI's table and
 * `GPQA-Diamond` in DeepSeek's are the same 198 questions; `MATH` in OpenAI's
 * table is two different test sets depending on which row you read. Left as
 * published, the grid grows a column per spelling and compares nothing.
 *
 * So every incoming label is resolved to a canonical id here, and never by
 * guesswork: a rename happens only when the source's own code or documentation
 * says what was run, and the sentence that proves it is carried alongside. When
 * the evidence does not reach a single answer, the score keeps a separate id
 * marked `-unspecified` — visible in the grid, excluded from the comparison.
 * An empty cell costs a reader nothing. A number lined up against a number from
 * a different test costs them the decision they came to make.
 */

/** What a label resolved to, and what makes that more than an assumption. */
export interface Resolution {
  /** The canonical id this score belongs under. */
  benchmark: string
  /** The label the source published, when it differs from the canonical id. */
  reportedAs?: string
  /** The evidence for the rename. Absent when nothing was renamed. */
  evidence?: string
}

/**
 * Labels that mean the same test wherever they appear.
 *
 * Only spelling lives here — spacing, casing, punctuation. Anything that
 * changes which questions were asked belongs in {@link SET_RULES}, where it
 * has to bring a source with it.
 */
const SPELLINGS: Record<string, string> = {
  'gpqa diamond': 'GPQA-Diamond',
  'gpqa-diamond': 'GPQA-Diamond',
  'math 500': 'MATH-500',
  'math-500': 'MATH-500',
  ifeval: 'IF-Eval',
  'if-eval': 'IF-Eval',
  'swe-bench verified': 'SWE-bench-Verified',
  'swebench-verified': 'SWE-bench-Verified',
  'humanitys-last-exam': "Humanity's-Last-Exam",
  'humanity-s-last-exam': "Humanity's-Last-Exam",
  hle: "Humanity's-Last-Exam",
  'aime 2024': 'AIME-2024',
  'aime 2025': 'AIME-2025',
  'livecodebench-v6': 'LiveCodeBench',
  /* Qwen's card writes the subtitled run as `Video-MME (w. sub)`; the
   * leaderboard that runs it calls the same column with-subtitles. The label
   * says which run it is, so there is nothing left to infer. */
  'video-mme (w. sub)': 'Video-MME-With-Subtitles',
  'video-mme (w. subs)': 'Video-MME-With-Subtitles',
}

/**
 * OpenAI evaluates `MATH` on two different test sets in one column.
 *
 * The README draws the line at o1 — "anything on or after o1" is scored on
 * MATH-500 — which settles the o-series and everything released before it, and
 * settles nothing for the models that came out after o1 without being reasoning
 * models. Those three keep `MATH-unspecified` until OpenAI says which set they
 * ran, because the difference between MATH and its 500-problem subset is a few
 * points, exactly the margin these tables are read for.
 */
const SIMPLE_EVALS_README =
  'openai/simple-evals README: "For newer models (anything on or after o1) we evaluate on MATH-500, which is a newer, IID version of MATH."'

/** Models the README's rule reaches: the o-series is scored on MATH-500. */
const O_SERIES = /^o\d/i

/** Models that shipped before o1-preview (2024-09-12), so on the full set. */
const PRE_O1 = [
  /^gpt-4-turbo/i,
  /^gpt-4-0125/i,
  /^gpt-4-1106/i,
  /^gpt-4o-2024-0[5-8]/i,
  /^gpt-4o-mini-2024-07/i,
]

/**
 * Per-source rules: what this publisher actually ran, on the record.
 *
 * Keyed by `benchmarkSet`, so a label is only reinterpreted for the source that
 * published it. `GPQA` from OpenAI is GPQA-Diamond; `GPQA` from somewhere else
 * would have to prove itself separately.
 */
const SET_RULES: Record<string, (label: string, model: string) => Resolution | null> = {
  'openai-simple-evals': (label, model) => {
    if (label === 'GPQA') {
      return {
        benchmark: 'GPQA-Diamond',
        reportedAs: 'GPQA',
        evidence:
          'openai/simple-evals gpqa_eval.py takes `variant: str = "diamond"` and loads gpqa_diamond.csv, so the published GPQA column is the Diamond subset.',
      }
    }

    if (label === 'MATH') {
      if (O_SERIES.test(model)) {
        return { benchmark: 'MATH-500', reportedAs: 'MATH', evidence: SIMPLE_EVALS_README }
      }
      if (PRE_O1.some((p) => p.test(model))) {
        return { benchmark: 'MATH', evidence: `${SIMPLE_EVALS_README} This model predates o1.` }
      }
      return {
        benchmark: 'MATH-unspecified',
        reportedAs: 'MATH',
        evidence: `${SIMPLE_EVALS_README} Released after o1 but not a reasoning model, so the rule does not say which set was used. Held out of the MATH comparison until it does.`,
      }
    }

    return null
  },
}

/** Resolve one published label to the id the grid files it under. */
export function resolveBenchmark(
  benchmarkSet: string,
  label: string,
  model: string,
): Resolution {
  const rule = SET_RULES[benchmarkSet]?.(label, model)
  if (rule) return rule

  const spelling = SPELLINGS[label.trim().toLowerCase()]
  if (spelling && spelling !== label) {
    return {
      benchmark: spelling,
      reportedAs: label,
      evidence: 'Same test, different spelling.',
    }
  }

  return { benchmark: spelling ?? label.trim() }
}

/**
 * The same test however a card happened to spell it.
 *
 * Labs write `Terminal Bench 2.1`, `Terminal-Bench 2.1` and `TerminalBench
 * 2.1` for one benchmark, and `CyberGym` and `Cybergym` for another. Folding
 * away case, spaces, hyphens and the `v` in front of a version number puts
 * those on one column.
 *
 * What it deliberately does not fold: version numbers themselves, named
 * subsets, and metric qualifiers. `TerminalBench` and `Terminal Bench 2.1` are
 * two versions of a test and stay apart; so do `AutomationBench` and
 * `AutomationBench (Public)`, and so do a pass rate and an Elo of the same
 * name. Those change what was measured, and merging them would put two
 * different questions in one column.
 */
export function foldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[()]/g, '')
    /* `(v1.1)` and ` 1.1` are the same version, written two ways. */
    .replace(/\bv(\d)/g, '$1')
    .replace(/[\s\-_]+/g, '')
}

/**
 * Which ids a source can produce, before any model is known.
 *
 * A source's `benchmarks` list is a header row: `MATH` there may end up as
 * MATH-500, MATH, or MATH-unspecified depending on the row. The grid's column
 * list is built from the claims that actually landed, so this only exists to
 * check a source's header against what came out of it.
 */
export function possibleIds(benchmarkSet: string, label: string): string[] {
  if (benchmarkSet === 'openai-simple-evals' && label === 'MATH') {
    return ['MATH-500', 'MATH', 'MATH-unspecified']
  }
  return [resolveBenchmark(benchmarkSet, label, '').benchmark]
}
