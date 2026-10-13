; Type declarations at any depth, with spans (the capture node is the type
; spec or alias, without the `type` keyword). Each kind has its own capture;
; @type.name is the simple name. Defined types over other types
; (`type ID int`) are not captured.
;   type S struct{...}    @type.struct
;   type I interface{...} @type.interface
;   type A = S            @type.alias
; @type.parameters is a generic type's `[T any]` list, inside the same span.
(type_spec
  name: (type_identifier) @type.name
  type: (struct_type)) @type.struct

(type_spec
  name: (type_identifier) @type.name
  type: (interface_type)) @type.interface

(type_alias
  name: (type_identifier) @type.name) @type.alias

(type_spec
  type_parameters: (type_parameter_list) @type.parameters)
