import { describe, expect, it } from 'vitest';
import { PRIOR_MAX_ADJUSTMENT, applyPriors, priorKey } from '../src/retrieval.js';

const hit = (id: string, score: number) => ({
  sourceType: 'knowledge_item',
  sourceId: id,
  title: id,
  content: id,
  score,
});

describe('applyPriors', () => {
  it('leaves ranking untouched when there are no priors', () => {
    const hits = [hit('a', 0.9), hit('b', 0.5)];
    expect(applyPriors(hits, new Map()).map((h) => h.sourceId)).toEqual(['a', 'b']);
  });

  it('reorders only within what similarity already retrieved', () => {
    const hits = [hit('a', 0.50), hit('b', 0.48)];
    const priors = new Map([[priorKey('knowledge_item', 'b'), 0.05]]);
    const ranked = applyPriors(hits, priors);
    expect(ranked.map((h) => h.sourceId)).toEqual(['b', 'a']);
    expect(ranked[0]!.prior).toBe(0.05);
    // Nothing new appears: a prior cannot introduce material the search missed.
    expect(ranked).toHaveLength(2);
  });

  it('cannot overturn a large similarity gap', () => {
    const hits = [hit('a', 0.9), hit('b', 0.2)];
    const priors = new Map([
      [priorKey('knowledge_item', 'b'), PRIOR_MAX_ADJUSTMENT],
      [priorKey('knowledge_item', 'a'), -PRIOR_MAX_ADJUSTMENT],
    ]);
    expect(applyPriors(hits, priors).map((h) => h.sourceId)).toEqual(['a', 'b']);
  });

  it('reports the adjustment it folded into the score', () => {
    const ranked = applyPriors([hit('a', 0.4)], new Map([[priorKey('knowledge_item', 'a'), 0.02]]));
    expect(ranked[0]!.score).toBeCloseTo(0.42, 6);
    expect(ranked[0]!.prior).toBeCloseTo(0.02, 6);
  });
});
