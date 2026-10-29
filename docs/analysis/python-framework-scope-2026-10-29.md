# Python framework scope regression checks, 2026-10-29

The framework fixes were checked against the pinned Python corpus with the existing grammar and report script. The baseline is the unmodified Python pack built in `/tmp/ndx-prd-drafts-worktree`; the changed pack is built on `work/final-items-closure`. Both read the same checked-out corpus SHAs. Fixture goldens are unchanged; all 138 Python tests pass.

| Repository | Pinned commit | Python files | Routes before | Routes after | Result |
|---|---|---:|---:|---:|---|
| django | `d430084791a61b31cecec132bce3dca19194f7f2` | 2933 | 740 | 725 | routes and notices change |
| netbox | `9023ed4972f6f8ba67673ad0bbff1bc36036dda2` | 1290 | 70 | 70 | notices change |
| poetry | `38a86661d2ae58694c76d0bb4e628e1400d6dc6f` | 451 | 0 | 0 | unchanged |
| full-stack-fastapi-template | `b1125d8839482cb7bbae603ddc6d0081bf87532e` | 43 | 23 | 23 | unchanged |
| ctfd | `28dee71cd24ee12f817bab5b5eea82769235e1f1` | 350 | 88 | 88 | unchanged |
| dispatch | `dd2837e82a0bf5565b1b4b4b91ea30b7262d4061` | 717 | 290 | 290 | unchanged |
| home-assistant-core | `e92f1bfeca5a9fb31f9c43c07094b4a649757649` | 19553 | 0 | 0 | unchanged |

Django now ignores URL-pattern assignments inside functions and classes. That removes 15 routes previously counted from `django/contrib/admin/sites.py` method bodies, along with two dynamic-path notices and one unfollowed-include notice from that file. The module-level regression fixture retains its original route and a conditional `+=` addition, and emits no misleading reassignment notice.

NetBox keeps all 70 routes. Its DRF-registration notice count changes from 147 to 146 after enforcing module bindings during cross-file following. FastAPI, Flask, Poetry, Dispatch and Home Assistant results are otherwise unchanged. A corpus check caught a first implementation that also stopped following imports inside the caller's own Flask factory; that was repaired before these figures were recorded.

The original task `2d8ed30f` asks for a byte-identical Django corpus report. That conflicts with removing the method-local URL patterns now demonstrated in this corpus. Its code fix is implemented and tested, but the task remains in progress pending review of this measured acceptance-criterion difference; it is not silently marked complete. The other three scope tasks allow documented corpus differences.

Commands (set `NDX_PYTHON_CORPUS_DIR` to the cloned corpus directory):

```sh
pnpm --filter @n-dx/lang-python build
pnpm --filter @n-dx/lang-python exec vitest run
node packages/sourcevision/scripts/python-routes-report.mjs --json
```

The task-to-regression links are `278055d7` (conditional rebinding), `5b2ea100` (constructor/import order), `2d8ed30f` (local URL patterns), and `452790b2` (package-local imports). Each new regression failed before the implementation change.
