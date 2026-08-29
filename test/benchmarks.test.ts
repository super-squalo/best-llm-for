import { describe, expect, it } from 'vitest'

import { possibleIds, resolveBenchmark } from '../scripts/benchmarks'

describe('resolveBenchmark', () => {
  it("files OpenAI's GPQA column under GPQA-Diamond, since that is what it ran", () => {
    const r = resolveBenchmark('openai-simple-evals', 'GPQA', 'o3')
    expect(r.benchmark).toBe('GPQA-Diamond')
    expect(r.reportedAs).toBe('GPQA')
    expect(r.evidence).toContain('gpqa_diamond.csv')
  })

  it('keeps a rename auditable by carrying the published label', () => {
    /* A reader who cannot find the number back on the source page has to take
     * the grid's word for it, which is the thing this project refuses to ask. */
    const r = resolveBenchmark('openai-simple-evals', 'MATH', 'o1')
    expect(r.reportedAs).toBe('MATH')
    expect(r.evidence).toBeTruthy()
  })

  it('scores the o-series on MATH-500, per the README rule', () => {
    for (const model of ['o1', 'o3-high', 'o4-mini-low', 'o3-mini']) {
      expect(resolveBenchmark('openai-simple-evals', 'MATH', model).benchmark).toBe('MATH-500')
    }
  })

  it('scores models released before o1 on the full MATH set', () => {
    for (const model of [
      'gpt-4-turbo-2024-04-09',
      'gpt-4-0125-preview',
      'gpt-4-1106-preview',
      'gpt-4o-2024-05-13',
      'gpt-4o-2024-08-06',
      'gpt-4o-mini-2024-07-18',
    ]) {
      const r = resolveBenchmark('openai-simple-evals', 'MATH', model)
      expect(r.benchmark).toBe('MATH')
      expect(r.reportedAs).toBeUndefined()
    }
  })

  it('holds out the models the rule does not reach rather than guessing', () => {
    /* Released after o1, not reasoning models: the README's line does not say
     * which set these ran, and a few points of MATH vs MATH-500 is exactly the
     * margin someone picks a model on. */
    for (const model of [
      'gpt-4.1-2025-04-14',
      'gpt-4.1-mini-2025-04-14',
      'gpt-4.1-nano-2025-04-14',
      'gpt-4.5-preview-2025-02-27',
      'gpt-4o-2024-11-20',
    ]) {
      expect(resolveBenchmark('openai-simple-evals', 'MATH', model).benchmark).toBe(
        'MATH-unspecified',
      )
    }
  })

  it('does not reinterpret a label for a source that never proved it', () => {
    /* GPQA from OpenAI is Diamond because OpenAI's code says so. The same word
     * from anyone else has to bring its own evidence. */
    const r = resolveBenchmark('some-other-lab', 'GPQA', 'whatever-1')
    expect(r.benchmark).toBe('GPQA')
    expect(r.reportedAs).toBeUndefined()
  })

  it('folds spelling differences together', () => {
    expect(resolveBenchmark('x', 'GPQA Diamond', 'm').benchmark).toBe('GPQA-Diamond')
    expect(resolveBenchmark('x', 'IFEval', 'm').benchmark).toBe('IF-Eval')
    expect(resolveBenchmark('x', 'HLE', 'm').benchmark).toBe("Humanity's-Last-Exam")
  })

  it('leaves an unknown label alone, trimmed', () => {
    const r = resolveBenchmark('x', '  BrandNewBench  ', 'm')
    expect(r.benchmark).toBe('BrandNewBench')
    expect(r.evidence).toBeUndefined()
  })

  it('reports every id a column can split into', () => {
    expect(possibleIds('openai-simple-evals', 'MATH')).toEqual([
      'MATH-500',
      'MATH',
      'MATH-unspecified',
    ])
    expect(possibleIds('deepseek-v3-readme', 'MMLU')).toEqual(['MMLU'])
  })
})
