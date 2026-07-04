import { describe, expect, it } from 'vitest';
import { computeCost, pricingForModel } from '../src/cost/pricing.js';

function usage(over: Partial<Parameters<typeof computeCost>[0]> = {}) {
  return {
    costUsd: null,
    model: 'claude-opus-4-8',
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    ...over,
  };
}

describe('computeCost', () => {
  it('computes input and output at current Opus rates', () => {
    expect(computeCost(usage({ tokensIn: 1_000_000 }))).toBeCloseTo(5);
    expect(computeCost(usage({ tokensOut: 1_000_000 }))).toBeCloseTo(25);
  });

  it('prices cache reads at 0.1x input', () => {
    expect(computeCost(usage({ cacheReadTokens: 1_000_000 }))).toBeCloseTo(0.5);
  });

  it('prices cache writes by TTL: 1.25x for 5m, 2x for 1h', () => {
    expect(computeCost(usage({ cacheWriteTokens: 1_000_000 }))).toBeCloseTo(6.25);
    expect(
      computeCost(usage({ cacheWriteTokens: 1_000_000, cacheWrite1hTokens: 1_000_000 })),
    ).toBeCloseTo(10);
    expect(
      computeCost(usage({ cacheWriteTokens: 1_000_000, cacheWrite1hTokens: 400_000 })),
    ).toBeCloseTo(0.6 * 6.25 + 0.4 * 10);
  });

  it('prefers the cost recorded in the log itself', () => {
    expect(computeCost(usage({ costUsd: 0.0234, tokensIn: 1_000_000 }))).toBe(0.0234);
  });

  it('returns null for unknown models and missing model', () => {
    expect(computeCost(usage({ model: 'gpt-9-mega' }))).toBeNull();
    expect(computeCost(usage({ model: null }))).toBeNull();
  });

  it('matches model families', () => {
    expect(pricingForModel('claude-sonnet-5')?.input).toBe(3);
    expect(pricingForModel('claude-haiku-4-5-20251001')?.input).toBe(1);
    expect(pricingForModel('claude-fable-5')?.input).toBe(10);
    expect(pricingForModel('claude-opus-4-1-20250805')?.input).toBe(15);
    expect(pricingForModel('claude-3-5-sonnet-20241022')?.input).toBe(3);
  });

  it('applies user pricing overrides and re-derives cache rates', () => {
    const overrides = { 'claude-opus-4-8': { input: 2, output: 8 } };
    expect(computeCost(usage({ tokensIn: 1_000_000 }), overrides)).toBeCloseTo(2);
    expect(computeCost(usage({ cacheReadTokens: 1_000_000 }), overrides)).toBeCloseTo(0.2);
    expect(computeCost(usage({ tokensOut: 1_000_000 }), overrides)).toBeCloseTo(8);
  });
});
