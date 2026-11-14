; Declarations at any depth. Each @<kind>.declaration spans the whole
; declaration, attributes and modifiers included; @<kind>.name is its name.
; Which methods are constructors is decided in php-symbols.ts.
(class_declaration name: (name) @class.name) @class.declaration
(interface_declaration name: (name) @interface.name) @interface.declaration
(trait_declaration name: (name) @trait.name) @trait.declaration
(enum_declaration name: (name) @enum.name) @enum.declaration
(function_definition name: (name) @function.name) @function.declaration
(method_declaration name: (name) @method.name) @method.declaration

; `namespace A\B;` and `namespace A\B { … }`. @namespace.body marks the
; braced form. A global `namespace { … }` has no name and is not captured.
(namespace_definition name: (namespace_name) @namespace.name) @namespace.declaration
(namespace_definition body: (compound_statement) @namespace.body)

; Constants: each element of `const A = 1, B = 2;`, at namespace level or in
; a class, interface, trait or enum body, is one declaration. The anchor takes
; the element's own name, not a name in its value (`const A = B;`).
(const_element . (name) @constant.name) @constant.declaration

; `define('NAME', …)` (any letter case, as PHP function names are) whose
; first argument is a string; php-symbols.ts keeps it only when the string is
; a plain literal name.
((function_call_expression
  function: (name) @_define
  arguments: (arguments . (argument . [(string) (encapsed_string)] @define.name))) @define.declaration
  (#match? @_define "^[dD][eE][fF][iI][nN][eE]$"))

; An anonymous class's body: its methods belong to no named class.
(anonymous_class body: (declaration_list) @class.anonymous_body)
