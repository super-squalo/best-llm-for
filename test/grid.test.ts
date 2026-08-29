import { describe, expect, it } from 'vitest'

import { coverage, findBenchmarks, humansOn, onBenchmark, rowsForModel } from '../src/grid'
import type { Claim, Grid, GridRow } from '../src/grid'

const claim = (over: Partial<Claim>): Claim => ({
  benchmark: 'GPQA-Diamond',
  score: 80,
  kind: 'claimed',
  by: 'ExampleLab',
  source: 'https://example.test',
  capturedAt: '2026-08-01',
  ...over,
})

const row = (model: string, claims: Claim[], over: Partial<GridRow> = {}): GridRow => ({
  model,
  family: model.replace(/-(high|max|low)$/, ''),
  claims,
  ...over,
})

const grid = (rows: GridRow[], humans: Grid['humans'] = []): Grid => ({
  generatedAt: '2026-08-29T00:00:00.000Z',
  humans,
  benchmarks: [...new Set(rows.flatMap((r) => r.claims.map((c) => c.benchmark)))].sort(),
  labelling: [],
  sources: [],
  rows,
})

describe('onBenchmark', () => {
  it('leads with the outsider and keeps the lab figure alongside', () => {
    /* The pair is the point. Dropping either would leave the reader with one
     * number and no way to know it was ever checked. */
    const g = grid([
      row('kimi-k2', [
        claim({ benchmark: 'Aider-Polyglot', score: 60, kind: 'claimed', by: 'Moonshot' }),
        claim({ benchmark: 'Aider-Polyglot', score: 59.1, kind: 'measured', by: 'Aider' }),
      ]),
    ])

    const [top] = onBenchmark(g, 'Aider-Polyglot')
    expect(top?.claim.kind).toBe('measured')
    expect(top?.claim.score).toBe(59.1)
    expect(top?.alsoClaimed?.score).toBe(60)
  })

  it('sorts hallucination rate the right way round', () => {
    /* The only benchmark here where less is better. Sorted like the others it
     * would put the worst model at the top of the list. */
    const g = grid([
      row('windy', [claim({ benchmark: 'Hallucination-Rate', score: 9.7, kind: 'measured' })]),
      row('careful', [claim({ benchmark: 'Hallucination-Rate', score: 1.8, kind: 'measured' })]),
    ])

    expect(onBenchmark(g, 'Hallucination-Rate').map((r) => r.row.model)).toEqual([
      'careful',
      'windy',
    ])
  })

  it('leaves out models nobody ran on it', () => {
    const g = grid([
      row('scored', [claim({ benchmark: 'MMLU', score: 90 })]),
      row('unscored', [claim({ benchmark: 'DROP', score: 90 })]),
    ])
    expect(onBenchmark(g, 'MMLU').map((r) => r.row.model)).toEqual(['scored'])
  })
})

describe('findBenchmarks', () => {
  const g = grid([
    row('a', [
      claim({ benchmark: 'GPQA-Diamond' }),
      claim({ benchmark: 'LiveBench/code_generation' }),
      claim({ benchmark: 'MMLU' }),
    ]),
    row('b', [claim({ benchmark: 'GPQA-Diamond' })]),
  ])

  it('finds a benchmark from the part of the name people type', () => {
    expect(findBenchmarks(g, 'gpqa')[0]).toBe('GPQA-Diamond')
    expect(findBenchmarks(g, 'code')[0]).toBe('LiveBench/code_generation')
  })

  it('puts the widest-covered match first', () => {
    /* A match with two models to compare beats one with a single row. */
    expect(findBenchmarks(g, 'm')[0]).toBe('GPQA-Diamond')
  })

  it('returns nothing for a name no source publishes', () => {
    expect(findBenchmarks(g, 'not-a-benchmark')).toEqual([])
  })
})

describe('rowsForModel', () => {
  const g = grid([
    row('claude-opus-5-max', [claim({ score: 90 })]),
    row('claude-opus-5-high', [claim({ score: 88 })]),
    row('gpt-5', [claim({ score: 80 })]),
  ])

  it('answers with every setting of the model asked about', () => {
    /* Someone asking about `claude-opus-5` wants both variants: the exact id
     * was never benchmarked, only its effort settings were. */
    expect(rowsForModel(g, 'claude-opus-5').map((r) => r.model)).toEqual([
      'claude-opus-5-max',
      'claude-opus-5-high',
    ])
  })

  it('finds a model by the words someone would type', () => {
    expect(rowsForModel(g, 'gpt').map((r) => r.model)).toEqual(['gpt-5'])
  })
})

describe('humansOn', () => {
  const g = grid(
    [row('a', [claim({ benchmark: 'MATH', score: 95 })])],
    [
      {
        benchmark: 'MATH',
        score: 40,
        who: 'a computer-science PhD student',
        source: 'https://arxiv.org/abs/2103.03874',
        quote: 'attained approximately 40% on MATH',
      },
      {
        benchmark: 'MATH',
        score: 90,
        who: 'a three-time IMO gold medallist',
        source: 'https://arxiv.org/abs/2103.03874',
        quote: 'got 18/20 = 90%',
      },
    ],
  )

  it('gives the published figures best first, each saying who the people were', () => {
    const people = humansOn(g, 'MATH')
    expect(people.map((h) => h.score)).toEqual([90, 40])
    /* "Humans score 90" is the claim this project exists to refuse. One
     * medallist and one PhD student are different facts about different people. */
    expect(people.every((h) => h.who.length > 0)).toBe(true)
  })

  it('says nothing where nobody published a human figure', () => {
    expect(humansOn(g, 'GPQA-Diamond')).toEqual([])
  })
})

describe('coverage', () => {
  it('counts a model once per benchmark, however many sources ran it', () => {
    const g = grid([
      row('a', [
        claim({ benchmark: 'MMLU', kind: 'claimed' }),
        claim({ benchmark: 'MMLU', kind: 'measured', by: 'Outsider' }),
      ]),
    ])
    expect(coverage(g).get('MMLU')).toBe(1)
  })
})
