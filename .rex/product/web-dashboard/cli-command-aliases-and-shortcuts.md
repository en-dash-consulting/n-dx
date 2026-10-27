---
id: "339476c0-333f-433e-aedf-1e1f3e890f82"
type: "capability"
title: "CLI Command Aliases and Shortcuts"
slug: "cli-command-aliases-and-shortcuts"
statement: "n-dx provides short command aliases, ndx for n-dx and sv for sourcevision, and lets users run rex, sourcevision and hench directly without the n-dx prefix."
criteria: [{"id":"c1","text":"When n-dx is installed, the installer shall place every command alias on the user's PATH."},{"id":"c2","text":"The CLI shall let users run rex commands directly, without the n-dx prefix."},{"id":"c3","text":"The CLI shall let users run sourcevision commands directly, without the n-dx prefix."},{"id":"c4","text":"The CLI shall let users run hench commands directly, without the n-dx prefix."},{"id":"c5","text":"The CLI shall accept 'ndx' as an alternative to 'n-dx' for the main command."},{"id":"c6","text":"The CLI shall accept 'sv' as a short alias for sourcevision in all contexts."}]
source: "smart-add"
---
