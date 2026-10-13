; Type declarations at any depth, top-level and nested, with their spans
; (the capture node covers modifiers, annotations and body). Each kind has
; its own capture name; @type.name is the simple name.
(class_declaration
  name: (identifier) @type.name) @type.class

(interface_declaration
  name: (identifier) @type.name) @type.interface

(enum_declaration
  name: (identifier) @type.name) @type.enum

(record_declaration
  name: (identifier) @type.name) @type.record

(annotation_type_declaration
  name: (identifier) @type.name) @type.annotation

; An anonymous class body (`new Runnable() { … }`). It is not a symbol; it marks
; where a member stops belonging to the named type around it.
; Kept out of the `type.*` names: java-sql.ts reads every `type.*` capture as a
; type declaration.
(object_creation_expression
  (class_body) @anonymous.body)
