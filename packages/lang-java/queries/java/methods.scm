; Method and constructor declarations. The capture node spans the whole
; declaration, so its start and end lines delimit the body; they feed
; near-duplicate detection. Interface and annotation-type methods without a
; body are included. A record's compact constructor is a constructor.
(method_declaration
  name: (identifier) @method.name) @method.declaration

(constructor_declaration
  name: (identifier) @constructor.name) @constructor.declaration

(compact_constructor_declaration
  name: (identifier) @constructor.name) @constructor.declaration

; Entry points: `public static void main` taking exactly one String[],
; String... or `String args[]` (String may be written java.lang.String).
; The capture is the method declaration. `_`-prefixed captures exist only for
; the predicates and are dropped by the runner. Java 25 instance main methods
; and compact source files (JEP 512) are not recognised; the pinned grammar
; cannot parse compact source files.
(method_declaration
  [
    (modifiers "public" "static")
    (modifiers "static" "public")
  ]
  type: (void_type)
  name: (identifier) @_entry_point.name
  parameters: (formal_parameters
    .
    [
      (formal_parameter
        type: (array_type
          element: [(type_identifier) (scoped_type_identifier)] @_entry_point.type
          dimensions: (dimensions) @_entry_point.dimensions)
        !dimensions)
      (formal_parameter
        type: [(type_identifier) (scoped_type_identifier)] @_entry_point.type
        dimensions: (dimensions) @_entry_point.dimensions)
      (spread_parameter
        [(type_identifier) (scoped_type_identifier)] @_entry_point.type)
    ]
    .)
  (#eq? @_entry_point.name "main")
  (#any-of? @_entry_point.type "String" "java.lang.String")
  (#eq? @_entry_point.dimensions "[]")) @entry_point.main

; Interface static methods are implicitly public unless declared private.
(interface_declaration body: (interface_body
(method_declaration
  (modifiers "static") @_entry_point.modifiers
  type: (void_type)
  name: (identifier) @_entry_point.name
  parameters: (formal_parameters
    .
    [
      (formal_parameter
        type: (array_type
          element: [(type_identifier) (scoped_type_identifier)] @_entry_point.type
          dimensions: (dimensions) @_entry_point.dimensions)
        !dimensions)
      (formal_parameter
        type: [(type_identifier) (scoped_type_identifier)] @_entry_point.type
        dimensions: (dimensions) @_entry_point.dimensions)
      (spread_parameter
        [(type_identifier) (scoped_type_identifier)] @_entry_point.type)
    ]
    .)
  (#eq? @_entry_point.name "main")
  (#not-match? @_entry_point.modifiers "(^|\\s)(public|private)(\\s|$)")
  (#any-of? @_entry_point.type "String" "java.lang.String")
  (#eq? @_entry_point.dimensions "[]")) @entry_point.main
))
