---
"@n-dx/web": patch
---

The dashboard's Self-Heal panel now starts `ndx self-heal` with `--auto`. The spawned process has no TTY, so it used to refuse without `selfHeal.autoConfirm`. `--auto` also skips self-heal's own confirmation prompt. The panel's "I understand — proceed" step replaces that prompt: it must be clicked before the Run button appears, and nothing is sent to `POST /api/commands/self-heal` until then. The panel's copy now says the run is unattended.
