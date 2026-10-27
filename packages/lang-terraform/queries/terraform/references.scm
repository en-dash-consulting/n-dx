; Reference expressions: a name followed by at least one attribute access.
; @reference spans the whole traversal (indexes and splats included);
; @reference.root is the first name and @reference.attribute the first access:
;   aws_db_subnet_group.this[0].name -> root "aws_db_subnet_group", attribute "this"
;   module.db.endpoint               -> root "module", attribute "db"
;   var.name, local.tags, data.aws_vpc.default.id
; The model reads the address from @reference's text; which roots name what is
; decided there, not here.
(expression
  .
  (variable_expr (identifier) @reference.root)
  .
  (get_attr (identifier) @reference.attribute)) @reference
