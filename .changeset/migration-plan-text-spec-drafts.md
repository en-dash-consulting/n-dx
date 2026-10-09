---
"@n-dx/rex": patch
---

The v2 migration plan redrafts capability specs with a text model (task class `prd.spec`, on by default through `planSeams`, which replaces `placementSeams`). The model sees only the capability's item, its applied history, its code files and its linked tests. Every criterion cites the item it came from; one citing no source, or an item outside the capability, is rejected and the template criteria are kept with a note. The plan records the answers, so an unchanged re-run does not ask again. The template draft stays as the fallback and is fixed: no "The product provides …" statement (a note asks for one), grammatical EARS for verb-led criteria ("removes dead exports" becomes "The system shall remove dead exports"), process criteria (tests pass, docs updated, changeset added) left out, tests linked only within the packages of the capability's code files, and no `specReviewed` field.
