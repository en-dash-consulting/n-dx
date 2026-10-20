; The `terraform` settings block, its provider requirements and its backend.
;
; A requirement is one attribute of `required_providers`, in either form:
;   aws = { source = "hashicorp/aws", version = ">= 5.0" }
;     -> @requirement (the attribute), @requirement.name "aws",
;        @requirement.source and @requirement.version (the values as written)
;   aws = ">= 2.0"   (the pre-0.13 form: the value is the version)
;     -> @requirement, @requirement.name "aws", @requirement.version
;
; The backend's type is its label without quotes: backend "s3" { … } -> "s3".
(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (#eq? @_keyword "terraform")) @terraform.block))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (block
          .
          (identifier) @_settings
          (body
            (attribute
              (identifier) @requirement.name) @requirement)
          (#eq? @_settings "required_providers")))
      (#eq? @_keyword "terraform"))))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (block
          .
          (identifier) @_settings
          (body
            (attribute
              (expression
                (collection_value
                  (object
                    (object_elem
                      .
                      (expression (variable_expr (identifier) @_key))
                      .
                      (expression) @requirement.source
                      (#eq? @_key "source")))))))
          (#eq? @_settings "required_providers")))
      (#eq? @_keyword "terraform"))))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (block
          .
          (identifier) @_settings
          (body
            (attribute
              (expression
                (collection_value
                  (object
                    (object_elem
                      .
                      (expression (variable_expr (identifier) @_key))
                      .
                      (expression) @requirement.version
                      (#eq? @_key "version")))))))
          (#eq? @_settings "required_providers")))
      (#eq? @_keyword "terraform"))))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (block
          .
          (identifier) @_settings
          (body
            (attribute
              (expression (literal_value (string_lit)) @requirement.version)))
          (#eq? @_settings "required_providers")))
      (#eq? @_keyword "terraform"))))

(config_file
  (body
    (block
      .
      (identifier) @_keyword
      (body
        (block
          .
          (identifier) @_backend
          .
          (string_lit (template_literal) @backend.type)
          (#eq? @_backend "backend")) @backend.block)
      (#eq? @_keyword "terraform"))))
