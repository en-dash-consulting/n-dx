---
id: "4f6b9dca-d9bb-4ca4-bc5e-ea33ffdde17d"
type: "capability"
title: "Trivial Wrapper Inlining and Pass-Through Abstraction Elimination"
slug: "trivial-wrapper-inlining-and-pass"
statement: "The codebase's production source has no pass-through wrapper functions and no intermediate modules that only re-export a single symbol, so callers reach the implementing function or module directly."
criteria: [{"id":"c1","text":"The production source shall contain no function whose entire body is a single call that passes its arguments unchanged to another function, with no added validation, transformation, guard clause or error handling."},{"id":"c2","text":"Call sites in production source shall invoke the delegated-to function directly rather than through a single-statement wrapper."},{"id":"c3","text":"The production source shall contain no module whose entire content is a single re-export of one symbol from one other file."},{"id":"c4","text":"Consumers of a symbol shall import it from its canonical source module, or through the appropriate gateway module, rather than through a single-symbol intermediate barrel."},{"id":"c5","text":"The production import graph shall contain no circular dependencies."}]
source: "smart-add"
---

Identify production functions whose entire body delegates to exactly one other function with no added validation, transformation, or error handling, and inline them at their call sites. Also remove intermediate helper modules that exist solely to re-export a single symbol from a deeper module. Reduces indirection and module count without changing behavior.
