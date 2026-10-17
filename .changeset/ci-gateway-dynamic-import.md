---
"@n-dx/core": patch
---

`ndx ci`'s gateway-imports step now also reports a dynamic `import("<pkg>")` of a
gated package outside its gateway, matching what the domain-isolation policy test
already enforces.

Changes a CLI result under the soft freeze: a file that loads a gated package with `import()` outside its gateway now makes the gateway-imports step report `ok: false` with a violation, where it previously passed.
