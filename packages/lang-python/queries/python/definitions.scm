; Classes and functions at any depth. The capture node spans the definition
; from `class`, `def` or `async def` to the end of its body; a function
; directly in a class body is a method (python-pack.ts).
(class_definition
  name: (identifier) @class.name) @class.declaration

(function_definition
  name: (identifier) @function.name) @function.declaration

; A decorated definition: @decorated.definition is the class or function it
; decorates, and each @decorated.decorator is one decorator's expression,
; without the `@`, in source order.
(decorated_definition
  definition: (_) @decorated.definition) @decorated.declaration

(decorated_definition
  (decorator (_) @decorated.decorator))
