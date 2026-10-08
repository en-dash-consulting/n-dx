; Imports. Every import yields @import.declaration and @import.name; the
; declaration text tells the forms apart, and the two marker captures sit
; inside the declaration's span:
;   import a.b.C;          -> name "a.b.C"
;   import a.b.*;          -> name "a.b", plus @import.wildcard
;   import static a.b.C.m; -> name "a.b.C.m", plus @import.static
;   import static a.b.C.*; -> name "a.b.C", plus both markers
(import_declaration
  [(identifier) (scoped_identifier)] @import.name) @import.declaration

(import_declaration "static" @import.static)

(import_declaration (asterisk) @import.wildcard)
