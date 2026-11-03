---
"@n-dx/rex": patch
---

Completing a v2 change's last task no longer stamps the auto-completed change with the completer as its author: the change keeps its `lastModifiedBy` and only its `lastModified` moves, as on v1 (#368). `ChangeLayerStore.updateItem` now honours `preserveModifiedBy`.
