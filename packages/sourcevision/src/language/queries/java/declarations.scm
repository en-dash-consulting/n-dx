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
