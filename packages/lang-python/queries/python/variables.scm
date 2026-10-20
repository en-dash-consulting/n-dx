; Names assigned directly at module level: `X = 1`, `X: int = 1`, `X: int`.
; @variable.declaration spans the statement. Tuple targets (`a, b = …`) and
; assignments nested in a module-level `if` or `try` are not captured.
(module
  (expression_statement
    (assignment
      left: (identifier) @variable.name)) @variable.declaration)

; `__all__` assigned a list or tuple at module level: @all.value is the
; value and each @all.item one element (comments included). The pack keeps
; the names only when every element is a plain string literal.
(module
  (expression_statement
    (assignment
      left: (identifier) @_target
      right: [(list) (tuple)] @all.value))
  (#eq? @_target "__all__"))

(module
  (expression_statement
    (assignment
      left: (identifier) @_target
      right: [
        (list (_) @all.item)
        (tuple (_) @all.item)
      ]))
  (#eq? @_target "__all__"))
