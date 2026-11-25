---
"@n-dx/sourcevision": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
---

With the PHP pack, a script a crontab runs now has its cron schedule as a structured field in classifications.json. The field gives the schedule as the crontab writes it (`*/5 * * * *`) and the crontab's path and line. Before, the schedule appeared only in the evidence text. CLI scripts get no schedule, and older classifications.json files still load.
