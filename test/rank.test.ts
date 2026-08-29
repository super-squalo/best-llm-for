import { describe, expect, it } from 'vitest'

import {
  familyOf,
  latestScore,
  rank,
  recentlyAdded,
  search,
  usablePrice,
  variantsOf,
} from '../src/index'
import type { Benchmark, Model, Price } from '../src/types'

const provenance = (fetchedAt: string) => ({
  source: 'test',
  url: 'https://example.test',
  fetchedAt,
})

const price = (input: number, output: number, over: Partial<Price> = {}): Price => ({
  input,
  output,
  vendor: 'acme',
  mode: 'standard',
  ...over,
})

const score = (n: number, over: Partial<Benchmark> = {}): Benchmark => ({
  name: 'arena-code',
  kind: 'voted',
  score: n,
  provenance: provenance('2026-08-01T00:00:00.000Z'),
  ...over,
})

const model = (id: string, over: Partial<Model> = {}): Model => ({
  id,
  firstSeen: '2026-01-01T00:00:00.000Z',
  name: id,
  prices: [],
  benchmarks: [],
  ...over,
})

describe('usable price', () => {
  it('takes the cheapest vendor', () => {
    const m = model('a', {
      prices: [price(5, 25, { vendor: 'first' }), price(3, 15, { vendor: 'second' })],
    })
    expect(usablePrice(m)?.vendor).toBe('second')
  })

  // Batch is half price and answers in hours; quoting it as the price sends
  // someone to a product that does not do what they need.
  it('ignores batch pricing unless asked for it', () => {
    const m = model('a', {
      prices: [price(5, 25), price(2.5, 12.5, { mode: 'batch' })],
    })

    expect(usablePrice(m)?.input).toBe(5)
    expect(usablePrice(m, ['standard', 'batch'])?.input).toBe(2.5)
  })

  it('ignores free tiers, which are rate limited rather than free', () => {
    const m = model('a', {
      prices: [price(1, 2), price(0, 0, { mode: 'free' })],
    })
    expect(usablePrice(m)?.input).toBe(1)
  })

  it('returns null when nothing usable is on offer', () => {
    expect(usablePrice(model('a', { prices: [price(0, 0, { mode: 'free' })] }))).toBeNull()
  })
})

describe('latest score', () => {
  // Scores accumulate rather than overwrite, so the history is visible. The
  // current answer is the most recent reading, not the first one recorded.
  it('picks the most recent reading', () => {
    const m = model('a', {
      benchmarks: [
        score(1400, { provenance: provenance('2026-01-01T00:00:00.000Z') }),
        score(1500, { provenance: provenance('2026-08-01T00:00:00.000Z') }),
      ],
    })
    expect(latestScore(m)?.score).toBe(1500)
  })

  it('can be asked for one benchmark in particular', () => {
    const m = model('a', {
      benchmarks: [score(1400), score(80, { name: 'swe-bench', kind: 'measured' })],
    })
    expect(latestScore(m, 'swe-bench')?.score).toBe(80)
  })

  it('returns null when the model was never measured', () => {
    expect(latestScore(model('a'))).toBeNull()
  })
})

describe('ranking', () => {
  const models = [
    model('top', { benchmarks: [score(1700)], prices: [price(5, 25)] }),
    model('cheap', { benchmarks: [score(1600)], prices: [price(0.07, 0.25)] }),
    model('unpriced', { benchmarks: [score(1650)] }),
    model('unscored', { prices: [price(1, 2)] }),
  ]

  it('orders by score, best first', () => {
    expect(rank(models).map((r) => r.model.id)).toEqual(['top', 'unpriced', 'cheap'])
  })

  it('leaves out anything nobody has measured', () => {
    expect(rank(models).some((r) => r.model.id === 'unscored')).toBe(false)
  })

  // The library keeps everything and lets the caller decide; the CLI is what
  // hides unsold models, since "best model you cannot buy" is rarely the
  // answer someone wants.
  it('can drop models nobody sells', () => {
    const ids = rank(models, { pricedOnly: true }).map((r) => r.model.id)
    expect(ids).toEqual(['top', 'cheap'])
  })

  // The question the tool exists for: with this much money, what is the best
  // I can get?
  it('respects a budget', () => {
    const within = rank(models, { maxInput: 1 })
    expect(within.map((r) => r.model.id)).toEqual(['cheap'])
  })

  it('respects an output budget too', () => {
    expect(rank(models, { maxOutput: 1 }).map((r) => r.model.id)).toEqual(['cheap'])
  })

  it('caps the rows', () => {
    expect(rank(models, { limit: 1 })).toHaveLength(1)
  })
})

describe('families', () => {
  it('strips effort suffixes', () => {
    expect(familyOf('claude-opus-5-max')).toBe('claude-opus-5')
    expect(familyOf('claude-opus-5-high')).toBe('claude-opus-5')
    expect(familyOf('claude-opus-5')).toBe('claude-opus-5')
  })

  it('strips billing suffixes', () => {
    expect(familyOf('claude-opus-5:batch')).toBe('claude-opus-5')
  })

  it('leaves an ordinary id alone', () => {
    expect(familyOf('kimi-k3')).toBe('kimi-k3')
  })

  // Vendors sell claude-opus-5; the leaderboard measures claude-opus-5-max.
  // Answering "no scores" for the thing people actually buy would be true and
  // useless.
  it('finds the scored variants of an unscored model', () => {
    const models = [
      model('claude-opus-5', { prices: [price(5, 25)] }),
      model('claude-opus-5-max', { benchmarks: [score(1691)] }),
      model('claude-opus-5-high', { benchmarks: [score(1663)] }),
      model('kimi-k3-max', { benchmarks: [score(1674)] }),
    ]

    const found = variantsOf(models, models[0] as Model)
    expect(found.map((m) => m.id)).toEqual(['claude-opus-5-max', 'claude-opus-5-high'])
  })

  it('does not claim a model as its own variant', () => {
    const m = model('claude-opus-5-max', { benchmarks: [score(1691)] })
    expect(variantsOf([m], m)).toEqual([])
  })
})

describe('what is new', () => {
  // Being first when a model lands is the point; being complete about models
  // everyone already knows is not.
  it('finds models seen in the last fortnight', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    const lastYear = '2025-01-01T00:00:00.000Z'

    const models = [model('old', { firstSeen: lastYear }), model('new', { firstSeen: yesterday })]
    expect(recentlyAdded(models).map((m) => m.id)).toEqual(['new'])
  })

  it('puts the newest first', () => {
    const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    const models = [model('a', { firstSeen: days(5) }), model('b', { firstSeen: days(1) })]
    expect(recentlyAdded(models).map((m) => m.id)).toEqual(['b', 'a'])
  })
})

describe('search', () => {
  const models = [
    model('claude-opus-5', { maker: 'Anthropic' }),
    model('claude-opus-5-max'),
    model('gpt-5.3-codex'),
  ]

  it('matches on every word, in any order', () => {
    expect(search(models, 'opus 5').map((m) => m.id)).toContain('claude-opus-5')
  })

  it('puts the shortest match first, which is the base model', () => {
    expect(search(models, 'opus')[0]?.id).toBe('claude-opus-5')
  })

  it('matches on the maker', () => {
    expect(search(models, 'anthropic').map((m) => m.id)).toEqual(['claude-opus-5'])
  })

  it('finds nothing for an empty query', () => {
    expect(search(models, '   ')).toEqual([])
  })
})
