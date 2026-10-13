; Imports, one match per import spec, whether single or inside a group.
; @import.name is the path without its quotes (interpreted or raw string);
; @import.spec spans the spec. The binding form is a marker capture inside
; the spec's span; a plain import has none:
;   import "a/b"        -> name "a/b"
;   import x "a/b"      -> name "a/b", @import.alias "x"
;   import . "a/b"      -> name "a/b", @import.dot
;   import _ "a/b"      -> name "a/b", @import.blank
(import_spec
  path: [
    (interpreted_string_literal (interpreted_string_literal_content) @import.name)
    (raw_string_literal (raw_string_literal_content) @import.name)
  ]) @import.spec

(import_spec name: (package_identifier) @import.alias)

(import_spec name: (dot) @import.dot)

(import_spec name: (blank_identifier) @import.blank)
