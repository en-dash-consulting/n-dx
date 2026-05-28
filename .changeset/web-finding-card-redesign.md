---
"@n-dx/web": patch
---

Redesign finding cards. The previous "left-bar + severity-tinted background"
treatment had two problems: a stray `.severity-warning` rule in tables.css
was washing entire warning cards in dark orange (orange text on orange
background — unreadable), and the left-bar-per-card pattern has become an
AI-dashboard tell. New design:

- Cards are a single neutral surface — no severity tint, no left bar.
- Severity reads from a small colored icon + small-caps label on the meta
  row. Color sits on the symbol, not on the entire card.
- Severity, type, and scope live on one quiet meta line separated by `·`
  instead of three competing badges with their own backgrounds.
- Body text gets the visual weight: high-contrast, 14 px, generous leading.

The `tables.css` bare `.severity-*` rules are not touched (they still apply
to real table cells); `.finding-card.severity-*` overrides them via higher
specificity so finding-card chrome isn't affected.
