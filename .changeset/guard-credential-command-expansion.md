---
"@n-dx/hench": patch
---

hench's guard refuses a denied credential command spelled with an unquoted brace or glob (`security {find-generic-password,-s} -w`, `security fin[d]-generic-password -w`, `node /x/get-key.m?s`) when sh's expansion could name the denied subcommand or helper script. Quoted characters and commands that are not denied still pass.
