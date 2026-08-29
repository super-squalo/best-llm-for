import { describe, expect, it } from 'vitest'

import { familyOf, nameVariants, normaliseName } from '../src/identity'
import { foldKey } from '../scripts/benchmarks'

describe('normaliseName', () => {
  it('treats punctuation and casing as noise', () => {
    expect(normaliseName('Claude 3.5 Sonnet')).toBe('claude-3-5-sonnet')
    expect(normaliseName('claude_3.5_sonnet')).toBe('claude-3-5-sonnet')
  })

  it('drops the marketplace prefix', () => {
    expect(normaliseName('anthropic/claude-opus-4.5')).toBe('claude-opus-4-5')
    expect(normaliseName('openai/gpt-5')).toBe('gpt-5')
  })

  it('drops a parenthetical qualifier on the snapshot', () => {
    expect(normaliseName('DeepSeek-V3 (Nov 2024)')).toBe('deepseek-v3')
  })

  it('keeps settings apart, because the setting changes the score', () => {
    /* Merging these would print one score for two different runs. */
    expect(normaliseName('claude-opus-5-max')).not.toBe(normaliseName('claude-opus-5-high'))
  })
})

describe('familyOf', () => {
  it('folds effort levels and thinking budgets into the model', () => {
    expect(familyOf('claude-opus-4-5-20251101-thinking-64k-high-effort')).toBe('claude-opus-4-5')
    expect(familyOf('claude-opus-4-7-xhigh-effort')).toBe('claude-opus-4-7')
    expect(familyOf('gemini-3.1-pro-preview-high')).toBe('gemini-3-1-pro')
  })

  it('puts every spelling of one model in the same family', () => {
    const spellings = [
      'anthropic/claude-opus-4.5',
      'claude-opus-4-5-20251101',
      'Claude Opus 4.5 (preview)',
      'claude-opus-4-5-thinking-32k-medium-effort',
    ]
    expect(new Set(spellings.map(familyOf)).size).toBe(1)
  })

  it('never folds a size or speed word — those are other models', () => {
    /* `-mini` and `-flash` are different weights sold under a shared name.
     * Folding them would average a cheap model into an expensive one. */
    expect(familyOf('gpt-4o-mini')).not.toBe(familyOf('gpt-4o'))
    expect(familyOf('gemini-3.5-flash')).not.toBe(familyOf('gemini-3.5-pro'))
    expect(familyOf('deepseek-v4-flash')).not.toBe(familyOf('deepseek-v4-pro'))
  })

  it('strips a deployment version', () => {
    expect(familyOf('amazon/nova-lite-v1:0')).toBe('nova-lite')
  })

  it('offers the exact name before the family', () => {
    const variants = nameVariants('claude-opus-4-5-20251101-high-effort')
    expect(variants[0]).toBe('claude-opus-4-5-20251101-high-effort')
    expect(variants).toContain('claude-opus-4-5')
  })
})

describe('foldKey', () => {
  it('folds spacing, casing and the v in a version number', () => {
    expect(foldKey('Terminal Bench 2.1')).toBe(foldKey('Terminal-Bench 2.1'))
    expect(foldKey('CyberGym')).toBe(foldKey('Cybergym'))
    expect(foldKey('LongBench-v2')).toBe(foldKey('LongBench v2'))
    expect(foldKey('DeepSWE (v1.1)')).toBe(foldKey('DeepSWE 1.1'))
  })

  it('keeps versions, subsets and metrics apart', () => {
    /* Different questions, or the same questions scored differently. Either
     * way, two numbers that must not share a column. */
    expect(foldKey('TerminalBench')).not.toBe(foldKey('Terminal Bench 2.1'))
    expect(foldKey('AutomationBench')).not.toBe(foldKey('AutomationBench (Public)'))
    expect(foldKey('GDPval-AA v2')).not.toBe(foldKey('GDPval-AA v2 (Elo)'))
    expect(foldKey('OSWorld 2.0')).not.toBe(foldKey('OSWorld-Verified'))
  })
})
