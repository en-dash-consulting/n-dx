; Method declarations. The capture node spans the whole declaration, so its
; start and end lines delimit the body.
;
;   @method.receiver       receiver type as written: `S`, `*S`, `G[T]`, `*G[T]`
;   @method.receiver_type  the base type name, without `*` or type arguments
;   @method.pointer        marker, present for a pointer receiver
(method_declaration
  name: (field_identifier) @method.name) @method.declaration

(method_declaration
  receiver: (parameter_list
    (parameter_declaration type: (_) @method.receiver)))

(method_declaration
  receiver: (parameter_list
    (parameter_declaration
      type: [
        (type_identifier) @method.receiver_type
        (generic_type type: (type_identifier) @method.receiver_type)
        (pointer_type [
          (type_identifier) @method.receiver_type
          (generic_type type: (type_identifier) @method.receiver_type)
        ])
      ])))

(method_declaration
  receiver: (parameter_list
    (parameter_declaration type: (pointer_type) @method.pointer)))
