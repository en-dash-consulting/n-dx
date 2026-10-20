; Resource and data blocks at the top level of a file. The block capture spans
; the whole block; type and name are the two labels without their quotes:
;   resource "aws_db_instance" "main" { … }   -> @resource.block, "aws_db_instance", "main"
;   data "aws_vpc" "default" { … }            -> @data.block, "aws_vpc", "default"
(config_file
  (body
    (block
      .
      (identifier) @_keyword
      .
      (string_lit (template_literal) @resource.type)
      .
      (string_lit (template_literal) @resource.name)
      (#eq? @_keyword "resource")) @resource.block))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      .
      (string_lit (template_literal) @data.type)
      .
      (string_lit (template_literal) @data.name)
      (#eq? @_keyword "data")) @data.block))
