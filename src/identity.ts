/**
 * Deciding when two names are the same model.
 *
 * Every source spells a model its own way. The Aider leaderboard writes
 * `DeepSeek Chat V2.5`, EvalPlus writes `DeepSeek-V3 (Nov 2024)`, LiveBench
 * writes `claude-opus-4-5-20251101-thinking-64k-high-effort`, and OpenRouter
 * sells `anthropic/claude-opus-4.5`. Line those up wrong and the grid either
 * scatters one model across five rows or, worse, merges two models that are
 * not the same thing and prints an average of them.
 *
 * Two levels, deliberately:
 *
 * {@link normaliseName} is exact identity — different punctuation, same model.
 * Anything that could be a different set of weights or a different setting
 * stays distinct here, so the row for `-high` never quietly absorbs `-max`.
 *
 * {@link familyOf} is the looser grouping used to show variants together and
 * to lend facts that hold for all of them, like a price or a release date. It
 * removes effort levels and thinking budgets — settings on one model, not
 * separate models — and nothing else.
 */

/** Punctuation, casing and the vendor prefix. Nothing that changes identity. */
export function normaliseName(raw: string): string {
  /* `openai/gpt-5` and `gpt-5` are one model; the prefix is the marketplace's. */
  const withoutVendor = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw

  return withoutVendor
    /* `DeepSeek-V3 (Nov 2024)` — a qualifier on the snapshot, not a model. */
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[\s._]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Settings, not models.
 *
 * Everything here is a knob on one set of weights: how hard it thinks, how
 * much room it gets to think in, whether the endpoint is the preview or the
 * final one. Size and speed words — `-mini`, `-flash`, `-nano`, `-pro` — are
 * emphatically not on this list: those are different models that happen to
 * share a name.
 */
const VARIANT_SUFFIXES = [
  '-max',
  '-high',
  '-medium',
  '-low',
  '-xhigh',
  '-effort',
  '-thinking',
  '-nothinking',
  '-reasoning',
  '-auto',
  '-preview',
  '-latest',
  '-beta',
  '-exp',
]

/** `-64k`, `-32k`: how much room the model was given to think in. */
const THINKING_BUDGET = /-\d+k$/

/** `-v1` on a Bedrock-style id: the deployment revision, not the model. */
const DEPLOYMENT_VERSION = /-v\d+$/

/** `-20251101`, `-2025-12-11`, `-2024-07-18`: which snapshot was tested. */
const SNAPSHOT_DATE = /-\d{8}$|-\d{4}-\d{2}-\d{2}$|-\d{4}-\d{2}$/

/**
 * The family a name belongs to: one model, whatever it was set to.
 *
 * `claude-opus-4-5-20251101-thinking-64k-high-effort` and `claude-opus-4.5`
 * are the same weights — one row was run by a leaderboard at a particular
 * setting, the other is what the marketplace sells. They earn different scores
 * and keep separate rows, but they share a price, a release date and a lineage,
 * and a reader looking at one wants to see the other.
 */
export function familyOf(name: string): string {
  /* Marketplaces append the billing mode or deployment revision after a colon:
   * `claude-opus-5:batch`, `nova-lite-v1:0`. Neither is a different model, and
   * the colon has to go before punctuation is flattened or `:batch` welds
   * itself onto the name. */
  const [beforeColon] = name.split(':')
  let out = normaliseName(beforeColon ?? name).replace(DEPLOYMENT_VERSION, '')

  let changed = true
  while (changed) {
    changed = false

    for (const suffix of VARIANT_SUFFIXES) {
      if (out.endsWith(suffix)) {
        out = out.slice(0, -suffix.length)
        changed = true
      }
    }
    if (THINKING_BUDGET.test(out)) {
      out = out.replace(THINKING_BUDGET, '')
      changed = true
    }
    if (SNAPSHOT_DATE.test(out)) {
      out = out.replace(SNAPSHOT_DATE, '')
      changed = true
    }
  }

  /* Bedrock and friends append a deployment version: `nova-lite-v1:0`. */
  const colon = out.indexOf(':')
  return colon === -1 ? out : out.slice(0, colon)
}

/**
 * The spellings a name might be found under, tightest first.
 *
 * Used for borrowing a fact that holds across a family — a price, a listing
 * date — from whichever source happens to publish it, without merging rows.
 */
export function nameVariants(name: string): string[] {
  const exact = normaliseName(name)
  return [...new Set([exact, exact.replace(SNAPSHOT_DATE, ''), familyOf(name)])].filter(Boolean)
}
