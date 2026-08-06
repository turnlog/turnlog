import { describe, expect, it } from 'vitest';
import { computeCost, pricingForModel } from '../src/cost/pricing.js';

function usage(over: Partial<Parameters<typeof computeCost>[0]> = {}) {
  return {
    costUsd: null,
    model: 'claude-opus-4-8',
    ts: null,
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

  it('matches legacy Opus 4.0 in both first-party and Vertex id forms', () => {
    expect(pricingForModel('claude-opus-4-20250514')?.input).toBe(15);
    expect(pricingForModel('claude-opus-4@20250514')?.input).toBe(15);
    // Opus 4.5+ stays on the current rate.
    expect(pricingForModel('claude-opus-4-5-20251101')?.input).toBe(5);
  });

  it('applies Sonnet 5 introductory pricing by record date', () => {
    const intro = '2026-07-15T12:00:00.000Z';
    const after = '2026-09-01T00:00:00.000Z';
    expect(pricingForModel('claude-sonnet-5', undefined, intro)?.input).toBe(2);
    expect(pricingForModel('claude-sonnet-5', undefined, intro)?.output).toBe(10);
    expect(pricingForModel('claude-sonnet-5', undefined, after)?.input).toBe(3);
    // No timestamp → sticker rate; other Sonnets are never intro-priced.
    expect(pricingForModel('claude-sonnet-5')?.input).toBe(3);
    expect(pricingForModel('claude-sonnet-4-6', undefined, intro)?.input).toBe(3);
    expect(
      computeCost(usage({ model: 'claude-sonnet-5', ts: intro, tokensOut: 1_000_000 })),
    ).toBeCloseTo(10);
  });

  it('matches OpenAI Codex model families', () => {
    expect(pricingForModel('gpt-5.6-terra')?.input).toBe(2);
    expect(pricingForModel('gpt-5.6-terra')?.output).toBe(12);
    expect(pricingForModel('gpt-5.6-sol')?.input).toBe(5);
    expect(pricingForModel('gpt-5.6-luna')?.output).toBeCloseTo(1.2);
    expect(pricingForModel('gpt-5.3-codex')?.output).toBe(14);
    expect(pricingForModel('gpt-5-codex')?.input).toBe(1.25);
    expect(pricingForModel('gpt-5.1-codex-max')?.input).toBe(1.25);
    expect(pricingForModel('gpt-5-mini')?.input).toBe(0.25);
    expect(pricingForModel('o4-mini')?.input).toBeCloseTo(1.1);
    expect(pricingForModel('o3')?.input).toBe(2);
    expect(pricingForModel('gpt-4.1')?.output).toBe(8);
  });

  it('prices OpenAI caching by era: 10% reads for gpt-5.x, free writes before', () => {
    expect(pricingForModel('gpt-5.6-terra')?.cacheRead).toBeCloseTo(0.2);
    expect(pricingForModel('gpt-5.6-terra')?.cacheWrite5m).toBeCloseTo(2.5);
    expect(pricingForModel('o3')?.cacheRead).toBe(0.5);
    expect(pricingForModel('o3')?.cacheWrite5m).toBe(0);
    expect(pricingForModel('gpt-4.1')?.cacheWrite5m).toBe(0);
    expect(
      computeCost(usage({ model: 'gpt-5.6-terra', tokensIn: 500_000, tokensOut: 250_000 })),
    ).toBeCloseTo(0.5 * 2 + 0.25 * 12);
  });

  it('applies user pricing overrides and re-derives cache rates', () => {
    const overrides = { 'claude-opus-4-8': { input: 2, output: 8 } };
    expect(computeCost(usage({ tokensIn: 1_000_000 }), overrides)).toBeCloseTo(2);
    expect(computeCost(usage({ cacheReadTokens: 1_000_000 }), overrides)).toBeCloseTo(0.2);
    expect(computeCost(usage({ tokensOut: 1_000_000 }), overrides)).toBeCloseTo(8);
  });
});
