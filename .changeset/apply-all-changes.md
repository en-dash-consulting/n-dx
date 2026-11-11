---
"@n-dx/web": patch
---

Open changes offers `Apply all…` for every change that is done and waiting to apply: it previews each one, then applies those that can in one step.

Each change applies against its own preview, so one edited since is skipped and named while the rest apply. If an apply fails partway through, for example because another command holds the PRD, the changes already applied are still reported and the rest are listed as not applied. A change still held in the Inbox is placed first, so Apply all leaves it out. The bar links to Settings → Workflow, whose `Apply amendments` choices now read in plain words: automatically when a change is done, after someone applies it, or when a release is stamped.
