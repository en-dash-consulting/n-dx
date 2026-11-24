# OpenAI pricing and context evidence

Verified 2026-11-16 against official model pages and the explicit Markdown tables
on [API pricing](https://developers.openai.com/api/docs/pricing.md).
The coordinator's retrieved references carry UTC timestamps on that date; the
pricing, GPT-6.1 Sol, GPT-6 Luna, GPT-6 Astra, GPT-5.5 and GPT-5.6 Terra pages were
also opened during implementation. Public documentation does not establish
account access or an installed CLI's effective configuration.

## Historical audit

The 2026-11-09 audit found GPT-6 models falling back to Sonnet rates and a 128K
context policy, incorrect retained GPT-5.5 pricing, and missing cache-write
premiums. It recorded GPT-6.1 Sol's 1.05M API context versus 500K Codex/Work
default. Those observations remain historical evidence; this implementation
uses the 2026-11-16 sources below rather than treating audit numbers as current
proof. Defaults, catalogs and intentional execution pins are unchanged.

## Verified coverage

Prices below are USD per million tokens: fresh input / output / cached input.
API context includes output. Each linked model page supplies its own rates and
context; pricing tables supply processing modes and cache-write durations.

| Model source | API context | Standard short-context rates |
|---|---:|---|
| [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | 1,050,000 | 2 / 10 / 0.1 |
| [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) | 1,050,000 | 1 / 5 / 0.05 |
| [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | 1,050,000 | 10 / 50 / 1 |
| [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | 1,050,000 | 0.1 / 0.5 / 0.01 |
| [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) | 1,050,000 | 2 / 10 / 0.2 |
| [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | 1,050,000 | 4 / 20 / 0.4 |
| [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | 1,050,000 | 2 / 12 / 0.2 |
| [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | 1,050,000 | 0.2 / 1.2 / 0.02 |
| [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) | 1,050,000 | 5 / 30 / 0.5 |
| [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) | 1,050,000 | 2.5 / 15 / 0.25 |
| [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) | 400,000 | 0.75 / 4.5 / 0.075 |
| [GPT-5.3 Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex) | 400,000 | 1.75 / 14 / 0.175 |
| [GPT-5.2 Codex](https://developers.openai.com/api/docs/models/gpt-5.2-codex) | 400,000 | 1.75 / 14 / 0.175 |
| [GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2) | 400,000 | 1.75 / 14 / 0.175 |
| [GPT-5.1 Codex Max](https://developers.openai.com/api/docs/models/gpt-5.1-codex-max) | 400,000 | 1.25 / 10 / 0.125 |
| [GPT-5.1 Codex mini](https://developers.openai.com/api/docs/models/gpt-5.1-codex-mini) | 400,000 | 0.25 / 2 / 0.025 |
| [GPT-5 Codex](https://developers.openai.com/api/docs/models/gpt-5-codex) | 400,000 | 1.25 / 10 / 0.125 |

GPT-5.3 Codex Spark's API page returned 404; its pricing/context remain unknown.
[Work models](https://learn.chatgpt.com/docs/models?surface=cli) documents its
retirement. A missing model is never mapped to a replacement for pricing.
Metadata snapshot normalization does not change the model passed to execution.

## Interpretation and limits

- GPT-6.1 Sol's Codex and Work default is 500,000 tokens, independently confirmed
  by its API page and Work models. Other effective Codex/Work windows remain
  unknown here; the API maximum is not evidence of a product default. Preflight
  reports `contextKnown: false` when using its conservative 128K policy fallback.
- API preflight reserves the documented 128K maximum output (922K input for
  1.05M models, 272K for 400K models), including where the page only states
  total context and output capacity. This is a conservative input policy.
- The pricing page's explicit short/long tables govern monetary estimates.
  Above 272K input, the entire request uses long rates, including cache tokens.
  Aggregated run input cannot reveal individual request sizes, so aggregate
  estimates retain standard short-context rates. GPT-5.4/5.5 describe session
  pricing: callers must carry a session's long-context tier across requests.
- Published Standard, Batch, Flex, Fast and Ultrafast combinations are stored
  literally; absent combinations return unknown. GPT-5.4 Batch/Flex cached
  input is the published rounded $0.13, not an inferred $0.125. Fast GPT-5.5
  uses 2.5x Standard, not the GPT-6 multiplier. No long Fast GPT-5.4/5.5 rate
  is invented. GPT-5.6 Sol's promotional rates expire November 30, 2026 and
  require re-verification then.
- GPT-5.6/6 cache writes distinguish 30 minutes and 12 hours. Older automatic
  caches have no separately published write tier: compatibility accounting
  charges uncached input normally, but explicitly requesting either write
  duration returns unknown. Regional/FedRAMP uplifts and tool charges are not
  included in the base API estimates.
- [Work pricing](https://learn.chatgpt.com/docs/pricing) separates API prices
  from subscription usage; Sol subscription usage has no long-context surcharge.
  Strict quotes return no API cost for subscription billing, or for Codex/Work
  without explicit API billing. Neither zero dollars nor API rates are inferred
  as the subscription bill.
- `MODEL_COSTS` and `MODEL_CONTEXT_WINDOWS` project this one registry for existing
  consumers. Dashboard/CLI aggregates and preflight therefore share base rates.
  Legacy `resolveModelPricing` still returns its labelled compatibility fallback
  (`known: false`, `pricedAs` on aggregate lines); it is not verified pricing.
  The strict `resolveOpenAICost` and preflight cost return undefined for unknowns.
  Dashboard estimates explain their assumptions and are not invoices.
