

`GET /api/rex/product/capability/:id` says whether the capability was ever met and whether its spec moved since, so a client can decide editorial eligibility without reading the display status (`changing` outranks `revised` and `proposed`). Soft freeze: `met` (`metAt` is recorded) and `specChangedSinceMet` (`metAt` is recorded and the spec no longer hashes to it) are new required booleans on `capability`.
