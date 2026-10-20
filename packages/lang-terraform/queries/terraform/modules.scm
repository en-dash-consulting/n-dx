; Module calls at the top level of a file: the call's name label, and its
; `source` and `version` arguments as written (the whole expression):
;   module "db" { source = "./modules/db"  version = "~> 6.0" }
;     -> @module.block, @module.name "db", @module.source, @module.version
(config_file
  (body
    (block
      .
      (identifier) @_keyword
      .
      (string_lit (template_literal) @module.name)
      (#eq? @_keyword "module")) @module.block))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (attribute
          (identifier) @_argument
          (expression) @module.source
          (#eq? @_argument "source")))
      (#eq? @_keyword "module"))))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (attribute
          (identifier) @_argument
          (expression) @module.version
          (#eq? @_argument "version")))
      (#eq? @_keyword "module"))))
