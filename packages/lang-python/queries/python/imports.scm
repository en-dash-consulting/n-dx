; Import statements, at any depth (module, function, class, conditional).
; @import.statement spans the statement; the parts below lie inside it.
;
;   import a.b            @import.module "a.b"
;   import a.b as c       @import.module "a.b"
;   import a, b           one @import.module each
;   from a.b import c     @import.from "a.b", @import.name "c"
;   from . import x       @import.from "."
;   from ..pkg import y   @import.from "..pkg"
;   from m import d as e  @import.name "d"
;   from m import (c, d)  one @import.name each, across lines too
;   from m import *       @import.wildcard
;
; `from __future__ import …` is its own node type (future_import_statement)
; and is not captured. Aliases are not captured.
(import_statement
  name: [
    (dotted_name) @import.module
    (aliased_import name: (dotted_name) @import.module)
  ]) @import.statement

(import_from_statement
  module_name: [(dotted_name) (relative_import)] @import.from) @import.statement

(import_from_statement
  name: [
    (dotted_name) @import.name
    (aliased_import name: (dotted_name) @import.name)
  ])

(import_from_statement
  (wildcard_import) @import.wildcard)
