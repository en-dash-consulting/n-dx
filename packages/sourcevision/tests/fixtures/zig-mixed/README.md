# zig-mixed fixture

A small TypeScript/JavaScript project with a Zig native module and a TOML
config file, used to exercise the inventory summary's `skippedExtensions`
and `analysedLanguages` fields: TypeScript/JavaScript are import-graph
analysed, Zig is inventoried but not analysed (no import parser), and
Markdown/TOML are skipped entirely by the default code-only walk.
