---
"@n-dx/sourcevision": patch
---

Keep the zone structure when LLM enrichment fails. Previously, when every enrichment batch failed (e.g. the model timed out), the pass returned only the templated build/asset/docs/config zones and silently dropped the un-enriched code zones — collapsing the analysis to a handful of structural zones with zero cross-zone crossings, despite logging "using algorithmic names". Now a failed pass falls back to the algorithmic Louvain names for the un-enriched code zones (merged with unchanged and templated zones), so a transient LLM outage costs only AI-polished names, not the zone graph or its crossings.
