---
title: "Spend"
description: "Cost by day, model and project — how it is computed, why it is an estimate, and the two ways naive counting gets it badly wrong."
---

# Spend

Cost by day, by model, by project — and cost filtered by a **search query**, which is the
one no dashboard can do.

Prompt-caching gets its own card, because cache reads and cache writes are priced very
differently from fresh input and are usually where the money actually goes.

## Always an estimate

Turnlog computes cost from the token counts in your own logs against a shipped price
table covering Anthropic and OpenAI rates. It is labelled an estimate everywhere, because
it is one: it is not your bill.

Cursor IDE sessions are the exception — they use the cost Cursor itself recorded.

Rates wrong for you — Bedrock, Vertex, an enterprise agreement, or plain disagreement?
Override any model with [`modelPricing`](/docs/reference/settings).

## Two ways naive counting gets this wrong

Both are worth knowing, because they are why a hand-rolled script disagrees with Turnlog.

**Usage repeats per line, not per response.** Claude Code writes one JSONL line per
content block, and every one of those lines repeats the *same* `message.id` and the *same*
usage object. Summing per line inflates cost by roughly **2.7×**. Turnlog counts usage
once per response.

**Resuming copies the whole history forward.** A resumed session's file contains
everything from the previous one, so counting per file bills the same conversation
repeatedly. Turnlog dedupes across a resume chain: the first occurrence of a message
wins.

## Calendar

Your sessions placed in time — a week timeline with sessions as blocks at their real
hours, or a month heat-map. Colour by project or by agent; whichever you choose fills the
block and the other becomes its edge stripe, so both encodings are always present.
