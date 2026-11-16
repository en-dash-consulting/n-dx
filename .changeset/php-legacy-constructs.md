---
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

With the PHP pack, `sv analyze` reports each use of a PHP construct later versions removed or deprecated, and `sdlc-profile.json` and `readiness.json` count them per repository.

Each rule cites the php.net page of every version it names: the migration guide from 5.6 on, the PHP 5 changelog for 5.3 to 5.5. Removed: `mysql_*`, `ereg*`/`split`, ASP and `<script language="php">` tags, call-time pass-by-reference, the `session_register` and magic-quotes functions, `mcrypt_*`, `create_function`, `each()`, `$s{0}` offsets, PHP 4 constructors, `(unset)` and `__autoload`. Deprecated: `${}` interpolation, `utf8_encode`/`utf8_decode` and likely dynamic properties. Short open tags `<?` and `==` between a non-numeric string and a number are review notices, never removals. A call of a function the repository declares itself (a polyfill) is not counted, nor is a `<% %>` JavaScript template (Underscore, EJS) inside a `<script>` element.

The profile's optional `ecosystem.php.legacyConstructs` holds `files`, `uses`, `notices`, per-rule counts (`rules`) and uses by the version that removed (`removedIn`) or deprecated (`deprecatedIn`) them. The lang-kit contract gains the `legacyConstructs` fact kind (`LegacyConstructFact`, `LanguageBoundary`, `LEGACY_STATUSES`). `scripts/php-corpus-report.mjs` counts a file whose only parse errors are `$s{0}` offsets as clean, so they are not counted twice. A repository without the PHP pack, or with no such construct, writes the same files as before.
