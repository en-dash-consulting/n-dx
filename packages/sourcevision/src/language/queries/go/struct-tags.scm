; Struct field tags. @field.tag is the literal as written, quotes included
; (a raw string in practice; an interpreted string is also legal). A field
; declared with several names (`A, B int`) yields one match per name. Embedded
; fields have no @field.name. The enclosing struct is the @type.struct span
; (types query) that contains the field.
(field_declaration
  name: (field_identifier) @field.name
  tag: [(raw_string_literal) (interpreted_string_literal)] @field.tag) @field.declaration

(field_declaration
  !name
  tag: [(raw_string_literal) (interpreted_string_literal)] @field.tag) @field.declaration
