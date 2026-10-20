; Input variables, outputs and locals at the top level of a file:
;   variable "name" { … }   -> @variable.block, @variable.name "name"
;   output "id" { … }       -> @output.block, @output.name "id"
;   locals { a = 1 }        -> @locals.block, and one @local (the attribute) with @local.name "a"
(config_file
  (body
    (block
      .
      (identifier) @_keyword
      .
      (string_lit (template_literal) @variable.name)
      (#eq? @_keyword "variable")) @variable.block))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      .
      (string_lit (template_literal) @output.name)
      (#eq? @_keyword "output")) @output.block))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (#eq? @_keyword "locals")) @locals.block))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (attribute
          (identifier) @local.name) @local)
      (#eq? @_keyword "locals"))))
