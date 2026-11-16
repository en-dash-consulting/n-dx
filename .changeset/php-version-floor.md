---
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

With the PHP pack, `sv analyze` reports the oldest PHP version each file's syntax needs, and `sdlc-profile.json` and `readiness.json` count the repository's PHP files by that version.

Each rule dates one construct (namespaces, short arrays, `??`, typed properties, `match`, enums, typed class constants and the rest, PHP 5.3 to 8.3) by the php.net page that introduces it, cited in the rule: the version's migration guide from 5.6 on, the PHP 5 changelog for 5.3 to 5.5, whose guides php.net no longer hosts. The floor is syntax only: functions, extensions and configuration play no part, so it is a lower bound. The lang-kit contract gains the `versionFloor` fact kind (`VersionFloorFact`, `compareLanguageVersions`); the profile's optional `ecosystem.php.versionFloors` holds `floors`, `none` and `highest`. A repository without the PHP pack, or with no dated syntax, writes the same files as before.
