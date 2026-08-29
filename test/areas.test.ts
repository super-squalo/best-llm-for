import { describe, expect, it } from 'vitest'

import { AREAS, areaOf, assisted, lowerIsBetter } from '../src/areas'

describe('areaOf', () => {
  it('sorts the benchmarks people actually choose on', () => {
    expect(areaOf('SWE-bench-Verified').key).toBe('codice')
    expect(areaOf('LiveBench/python').key).toBe('codice')
    expect(areaOf('Aider-Polyglot').key).toBe('codice')
    expect(areaOf('MMBench-EN').key).toBe('immagini')
    expect(areaOf('OCRBench').key).toBe('immagini')
    expect(areaOf('Video-MME').key).toBe('video')
    expect(areaOf('Toolathlon-Verified').key).toBe('agenti')
    expect(areaOf('AIME-2025').key).toBe('matematica')
    expect(areaOf('GPQA-Diamond').key).toBe('ragionamento')
  })

  it('reads a maths test given as pictures as a vision test', () => {
    /* MathVista is failed by not seeing the diagram, not by not knowing
     * algebra. Filing it under maths would rank text-only models on a test
     * they cannot take. */
    expect(areaOf('MathVista').key).toBe('immagini')
  })

  it('files every benchmark somewhere', () => {
    for (const name of ['SomethingNobodyHasHeardOf', '', 'τ³-Banking', '$OneMillion-Bench']) {
      expect(AREAS.map((a) => a.key)).toContain(areaOf(name).key)
    }
  })

  it('keeps the areas few enough to choose between', () => {
    /* Six is the point. A list of areas long enough to need scrolling is the
     * same problem as a list of benchmarks. */
    expect(AREAS.length).toBeLessThanOrEqual(6)
  })
})

describe('assisted', () => {
  it('marks the runs where the model was given help', () => {
    expect(assisted('Video-MME-With-Subtitles')).toBe(true)
    expect(assisted('HLE w/ tools')).toBe(true)
    expect(assisted('Video-MME (w. sub)')).toBe(true)
  })

  it('leaves the unaided runs alone', () => {
    expect(assisted('Video-MME')).toBe(false)
    expect(assisted("Humanity's-Last-Exam")).toBe(false)
    expect(assisted('MMBench-EN')).toBe(false)
  })
})

describe('lowerIsBetter', () => {
  it('knows the one that runs backwards', () => {
    /* Sorted like everything else, this column puts the model that makes
     * things up most often at the top of the table. */
    expect(lowerIsBetter('Hallucination-Rate')).toBe(true)
    expect(lowerIsBetter('GPQA-Diamond')).toBe(false)
  })
})
