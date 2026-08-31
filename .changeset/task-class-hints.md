---
"@n-dx/core": patch
---

List the known task classes in `ndx config --help`, and tell users when a
route class looks mistyped.

`llm.routes.<class>` and `llm.effort.<class>` accept any class name on
purpose: glob keys (`prd.*`, `*`) are a routing feature, and a class added to
the registry in a newer release has to keep working against an older CLI. The
cost of that openness was silence — `ndx config llm.routes.agent.exceute heavy`
was accepted, written, and matched nothing, so the user saw success and got the
old model.

Setting an unrecognized class now prints a note saying so, naming the closest
known class when one is within an edit distance of three. Three catches the
realistic typos — a transposition, a dropped or doubled character, a wrong
suffix — without pointing `zone.enrich-scan` at `code.classify`; beyond it the
note still appears and only the suggestion is withheld. It remains advisory in
every case: the value is written, the exit status is unchanged, and globs and
known classes stay silent.

`ndx config --help` now lists all nineteen classes grouped by package with the
tier each routes to by default, so the set is discoverable without reading
source.

The class list is duplicated from `@n-dx/llm-client`'s `DEFAULT_ROUTES` rather
than imported, because orchestration-tier scripts must not import from
packages — the same reason `LLM_VENDOR` is declared locally in that file. A
new integration test fails when the copy drifts, checking not just the keys and
tiers but that no known class is ever reported as unknown: that is the failure
drift produces, and it hands the user advice that is exactly backwards.
