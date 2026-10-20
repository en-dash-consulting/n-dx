; Package-level functions. The capture node spans the whole declaration, so
; its start and end lines delimit the body. @function.parameters is the
; `[T any]` list of a generic function, inside the same span.
(function_declaration
  name: (identifier) @function.name) @function.declaration

(function_declaration
  type_parameters: (type_parameter_list) @function.parameters)
