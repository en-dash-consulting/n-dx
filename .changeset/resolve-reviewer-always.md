---
"@n-dx/hench": patch
"@n-dx/web": patch
---

`ndx work --resolve` always reports the reviewer model, its source and the vendor's built-in reviewer (`vendorDefault`), with or without `--review`. The Prepare task modal shows that reviewer when review is switched on, and its "Vendor default" choice sends the built-in model explicitly.
