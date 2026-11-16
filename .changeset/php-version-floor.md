---
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

With the PHP pack, `sv analyze` reports the oldest PHP version each file's syntax needs, and `sdlc-profile.json` and `readiness.json` count the repository's PHP files by that version.

Each rule dates one construct (namespaces, short arrays, `??`, typed properties, `match`, enums, typed class constants and the rest, PHP 5.3 to 8.3) by the php.net page that introduces it, cited in the rule: the version's migration guide from 5.6 on, the PHP 5 changelog for 5.3 to 5.5, whose guides php.net no longer hosts. The floor is syntax only: functions, extensions and configuration play no part, so it is a lower bound. Two things date nothing: what the parser's error recovery made of code it cannot parse (a PHP 5 `$s{0}` offset), and an attribute alone on its line, which PHP before 8.0 reads as a `#` comment. The lang-kit contract gains the `versionFloor` fact kind (`VersionFloorFact`, `compareLanguageVersions`); the profile's optional `ecosystem.php.versionFloors` holds `floors`, `none` and `highest`. A repository whose PHP has no dated syntax still gets the counts, with no `highest`, so an all-PHP-5 repository is not mistaken for one the pack never read. A repository without PHP files or without the PHP pack writes the same files as before.
