import type { NormalizedRecord } from '../parser/types.js';

/** USD per million tokens. Cache write rates: 1.25x input (5m TTL), 2x (1h TTL). */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

function rates(input: number, output: number): ModelPricing {
  return {
    input,
    output,
    cacheRead: input * 0.1,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
  };
}

/** Pre-gpt-5 OpenAI rates: cached input at a flat rate, cache writes free. */
function oaiRates(input: number, output: number, cacheRead: number): ModelPricing {
  return { input, output, cacheRead, cacheWrite5m: 0, cacheWrite1h: 0 };
}

/**
 * Shipped pricing table, updated via npm releases. Matched top to bottom —
 * most specific pattern first. All costs shown to users are labeled estimates.
 * Rates current as of 2026-08 (per MTok). Costs are computed at index time, so
 * a table change only reaches existing indexes via an adapter-version bump.
 */
const PRICING_TABLE: ReadonlyArray<readonly [RegExp, ModelPricing]> = [
  [/fable|mythos/, rates(10, 50)],
  // Legacy expensive Opus generations (4.1 and earlier, Claude 3 Opus).
  // `opus-4[-@]2025` covers both first-party/Bedrock (claude-opus-4-20250514)
  // and Vertex (claude-opus-4@20250514) forms of the Opus 4.0 id.
  [/opus-4-1|opus-4[-@]2025|claude-3-opus/, rates(15, 75)],
  [/opus/, rates(5, 25)],
  [/claude-3-5-haiku|haiku-3-5/, rates(0.8, 4)],
  [/claude-3-haiku/, rates(0.25, 1.25)],
  [/haiku/, rates(1, 5)],
  [/sonnet/, rates(3, 15)],
  // OpenAI (Codex sessions). gpt-5.x rates share the exact shape rates()
  // derives — cached input 10% of input, cache writes 1.25× (Codex reports no
  // 1h-TTL writes, so the 2× leg is inert). Bare /gpt-5/ is the family
  // fallback: unknown future ids get base-model rates rather than no price.
  [/gpt-5\.6-sol|gpt-5\.5/, rates(5, 30)],
  [/gpt-5\.6-luna/, rates(0.2, 1.2)],
  [/gpt-5\.6/, rates(2, 12)], // -terra; unknown 5.6 variants estimate as Terra
  [/gpt-5\.4-mini/, rates(0.75, 4.5)],
  [/gpt-5\.4-nano/, rates(0.2, 1.25)],
  [/gpt-5\.3-codex/, rates(1.75, 14)],
  [/gpt-5-pro/, rates(15, 120)],
  [/gpt-5-mini/, rates(0.25, 2)],
  [/gpt-5-nano/, rates(0.05, 0.4)],
  [/gpt-5/, rates(1.25, 10)], // gpt-5, gpt-5-codex, gpt-5.1/5.2 variants
  [/codex-mini/, oaiRates(1.5, 6, 0.375)],
  [/o4-mini/, oaiRates(1.1, 4.4, 0.275)],
  [/o3-pro/, oaiRates(20, 80, 5)],
  [/o3-mini/, oaiRates(1.1, 4.4, 0.55)],
  [/o3/, oaiRates(2, 8, 0.5)],
  [/gpt-4\.1-mini/, oaiRates(0.4, 1.6, 0.1)],
  [/gpt-4\.1-nano/, oaiRates(0.1, 0.4, 0.025)],
  [/gpt-4\.1/, oaiRates(2, 8, 0.5)],
];

// Sonnet 5 launched with introductory pricing through 2026-08-31; the sticker
// rate above applies from 2026-09-01. ISO timestamps compare lexically.
const SONNET5_INTRO_END = '2026-09';
const SONNET5_INTRO = rates(2, 10);

export function pricingForModel(
  model: string,
  overrides?: Record<string, Partial<ModelPricing>>,
  /** Record timestamp — selects date-bound rates (Sonnet 5 intro pricing). */
  ts?: string | null,
): ModelPricing | null {
  let base: ModelPricing | null = null;
  for (const [pattern, pricing] of PRICING_TABLE) {
    if (pattern.test(model)) {
      base = pricing;
      break;
    }
  }
  if (base && ts && ts < SONNET5_INTRO_END && /sonnet-5/.test(model)) {
    base = SONNET5_INTRO;
  }
  if (overrides) {
    // Exact model-id override wins; otherwise substring keys apply.
    const override =
      overrides[model] ??
      Object.entries(overrides).find(([key]) => model.includes(key))?.[1];
    if (override) {
      const merged = { ...(base ?? rates(0, 0)), ...override };
      // Re-derive cache rates from an overridden input rate unless given explicitly.
      if (override.input !== undefined) {
        merged.cacheRead = override.cacheRead ?? override.input * 0.1;
        merged.cacheWrite5m = override.cacheWrite5m ?? override.input * 1.25;
        merged.cacheWrite1h = override.cacheWrite1h ?? override.input * 2;
      }
      return merged;
    }
  }
  return base;
}

/**
 * Cost of one record in USD. Prefers the cost the log itself recorded (older
 * CC versions wrote costUSD per message); otherwise computes from token usage
 * and the pricing table. Returns null when there is nothing to compute.
 */
export function computeCost(
  rec: Pick<
    NormalizedRecord,
    | 'costUsd' | 'model' | 'ts' | 'tokensIn' | 'tokensOut'
    | 'cacheReadTokens' | 'cacheWriteTokens' | 'cacheWrite1hTokens'
  >,
  overrides?: Record<string, Partial<ModelPricing>>,
): number | null {
  if (rec.costUsd !== null) return rec.costUsd;
  if (!rec.model) return null;
  const p = pricingForModel(rec.model, overrides, rec.ts);
  if (!p) return null;

  const write1h = Math.min(rec.cacheWrite1hTokens, rec.cacheWriteTokens);
  const write5m = rec.cacheWriteTokens - write1h;
  const usd =
    (rec.tokensIn * p.input +
      rec.tokensOut * p.output +
      rec.cacheReadTokens * p.cacheRead +
      write5m * p.cacheWrite5m +
      write1h * p.cacheWrite1h) /
    1_000_000;
  return usd;
}
