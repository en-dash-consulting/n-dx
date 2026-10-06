---
"@n-dx/rex": patch
"@n-dx/web": patch
---

PRD items can carry a `run` block of saved run settings (model, provider, permission mode, review, review model, review optional, skip test gate, max turns, token budget, context notes). It round-trips through the folder tree, an empty block is never written, and rex exports `validateRunSettings` so every writer applies the same rules. Writers (MCP, `rex update --run`) reject a malformed block; the store keeps a hand-edited or newer-version block unchanged, warns on load, and never lets it block writes to other items. Nothing reads the block yet.
