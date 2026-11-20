---
"@n-dx/web": patch
---

Work's `Ready to run` shows the top three tasks again (it had gone back to ten), each as a card in the old Up next format with its type, priority, run button, title, description and tags. `Show all N` still lists the rest with search and filters.

The first card leads with two lines of description, the rest one. The panel's header says how many tasks are ready. `/api/hench/ready` now sends each row's `description`, cut to 200 characters, when the item has one.
