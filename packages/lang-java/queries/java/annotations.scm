; Annotation uses, with the string and boolean values written directly in
; their arguments. @annotation.use spans the whole annotation; @annotation.name
; is the name as written (`Query`, `jakarta.persistence.Table`).
;
; A single unnamed value (`@Query("...")`) is @annotation.string_argument. A
; named one (`@Query(value = "...", nativeQuery = true)`) is an
; @annotation.pair holding @annotation.key and one of @annotation.string_value
; or @annotation.true_value. Pair a value with its annotation by the innermost
; @annotation.use that contains it: `@A(b = @C(d = "x"))` gives "x" to C.
;
; Values built by concatenation or constants (`"a" + B`, `TABLE`) are not
; captured.
(annotation
  name: (_) @annotation.name
  arguments: (annotation_argument_list) @annotation.arguments) @annotation.use

(marker_annotation
  name: (_) @annotation.name) @annotation.use

(annotation_argument_list
  (string_literal) @annotation.string_argument)

(annotation_argument_list
  (element_value_pair
    key: (identifier) @annotation.key
    value: (string_literal) @annotation.string_value) @annotation.pair)

(annotation_argument_list
  (element_value_pair
    key: (identifier) @annotation.key
    value: (true) @annotation.true_value) @annotation.pair)
