---
"@n-dx/hench": patch
---

`ndx work` in a PHP project now reports skipped PHP guards as skipped, with the reasons, instead of as passed.

When every PHP check was skipped, the gate event reads "PHP guards skipped" and lists why. When one check ran and passed and another was skipped, it reads "PHP guards passed — N check(s) skipped" with the reasons. Neither fails the run.

Each changed path reaches `php -l` as `./<path>`, so a file named like an option (`-zx.php`) is linted, never read as one.
