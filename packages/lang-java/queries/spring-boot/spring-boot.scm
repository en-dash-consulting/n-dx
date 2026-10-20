; What the Spring Boot rules (src/spring-boot.ts) need beyond the Java
; queries: every annotation value whatever its form, declared variable types,
; and every call argument. Run only when routes or outbound calls are wanted.
;
; @spring.element is one element of an annotation's argument list: an
; element_value_pair (`value = "/a"`), or the single unnamed value written
; directly (`"/a"`, `{"/a", "/b"}`, `PATH`). Inside a pair, @spring.key is the
; key and @spring.value the value. @spring.item is one entry of an array value
; (`{"/a", B}`). Pair each with its annotation by the innermost
; @annotation.use (annotations.scm) that contains it.
(annotation_argument_list
  (_) @spring.element)

(element_value_pair
  key: (identifier) @spring.key
  value: (_) @spring.value)

(element_value_array_initializer
  (_) @spring.item)

; A declared variable: a field, a local or a parameter. @spring.variable spans
; the declaration; @spring.variable.type is its type as written and each
; @spring.variable.name a name it declares (`RestTemplate a, b;` has two).
(field_declaration
  type: (_) @spring.variable.type
  declarator: (variable_declarator
    name: (identifier) @spring.variable.name)) @spring.variable

(local_variable_declaration
  type: (_) @spring.variable.type
  declarator: (variable_declarator
    name: (identifier) @spring.variable.name)) @spring.variable

(formal_parameter
  type: (_) @spring.variable.type
  name: (identifier) @spring.variable.name) @spring.variable

; Each argument of a method invocation, in order. Pair it with its call by the
; innermost @call.arguments (calls.scm) that contains it. Comments are
; captured too; readers skip them.
(method_invocation
  arguments: (argument_list
    (_) @spring.argument))
