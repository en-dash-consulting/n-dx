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
