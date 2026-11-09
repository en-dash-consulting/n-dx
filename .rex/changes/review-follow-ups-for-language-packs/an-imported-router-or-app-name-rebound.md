---
id: "35351c50-4bad-4e37-8810-4e8bec407a30"
type: "task"
title: "An imported router or app name rebound locally to a non-router is still followed through its import"
slug: "an-imported-router-or-app-name-rebound"
description: "Dropped as not worth fixing by the adversarial review of 965c4f42; fixed on request. `WebProject.defined` (packages/lang-python/src/python-web.ts, `follow`) follows a file's `from x import name` binding whenever `defines(file, name)` is false. It ignores a module-level assignment in the same file that rebinds `name`: `from .routers import router` then `router = make_other()`. So `router.register(...)` there is counted as a DRF registration (django.ts `isRouter`), and the same lookup in python-routers.ts can follow a rebound FastAPI/Flask router or app name to the wrong file.\n\nFix: in `follow`, a module-level binding of `name` in the file wins over the import when it comes after the import (Python's last binding at module level wins). Then `follow` does not follow the import, and returns the local definition when `defines` accepts it, else undefined. An assignment before the import is overridden by the import, so the import is still followed. Use the bindings and assignments `readWebFile` already has (WebAssignment carries targetNode for positions). Bindings inside functions or classes are not module-level and do not count."
acceptanceCriteria:
  - "`from .routers import router` followed by a module-level `router = make_other()` is not counted as a DRF registration, and a FastAPI/Flask router name rebound the same way is not followed through its import"
  - "An assignment before the import, or one inside a function, does not stop the import being followed"
  - "Existing goldens unchanged; corpus routes and notices byte-identical (session verifies)"
priority: "low"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Ship as one commit on feat/sv-lang-pr16c-analysed-languages with a @n-dx/lang-python patch changeset. Keep conditional module-level rebinding (inside `if`/`try` at module level) simple: treat it as a module-level binding by position, and say so in AGENTS.md only if it fits the budget (agents-md-size-budget test). The hench sandbox may block ~/.cache; if it does, leave the corpus checks to the session, which verifies them; do not capture follow-ups for them."}
tags:
  - "lang-python"
  - "frameworks"
  - "pr-16"
source: "review"
---
