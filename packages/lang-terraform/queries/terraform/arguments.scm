; Arguments and nested blocks inside top-level blocks, at any depth. The
; model places each by span inside the innermost block around it, so
;   resource "x" "y" { build_config { runtime = "go121" } }
; gives the resource's argument path build_config.runtime.
;   @argument (the attribute), @argument.name, @argument.value (the expression)
;   @nested (a block inside a block), @nested.type (its first identifier)
(config_file
  (body
    (block
      (body
        (attribute
          (identifier) @argument.name
          (expression) @argument.value) @argument))))

(block
  (body
    (block
      (body
        (attribute
          (identifier) @argument.name
          (expression) @argument.value) @argument))))

(block
  (body
    (block
      .
      (identifier) @nested.type) @nested))
