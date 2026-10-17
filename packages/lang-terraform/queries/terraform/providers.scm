; Provider configurations at the top level of a file, with their `alias`:
;   provider "aws" { alias = "west" }   -> @provider.block, @provider.name "aws", @provider.alias
(config_file
  (body
    (block
      .
      (identifier) @_keyword
      .
      (string_lit (template_literal) @provider.name)
      (#eq? @_keyword "provider")) @provider.block))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (attribute
          (identifier) @_argument
          (expression) @provider.alias
          (#eq? @_argument "alias")))
      (#eq? @_keyword "provider"))))
