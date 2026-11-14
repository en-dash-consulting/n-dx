; Class references, at any depth: the names php-resolver.ts qualifies and
; resolves to files. Each capture is one class name as written (`Foo`,
; `\Foo\Bar`, `namespace\Foo`); the capture name says where it stands.
; `self`, `static` and `parent` are relative scopes or are dropped by the
; resolver; scalar types are primitive_type, never captured. A name built at
; run time (`new $class`, `$class::m()`) is not a name and is not captured.
;
;   class A extends B implements C {}      @reference.extends "B", @reference.implements "C"
;   interface I extends J {}               @reference.extends "J"
;   use T;  (in a class body)              @reference.trait "T"
;   new M()  new N                         @reference.new
;   X::m()  X::C  X::class  X::$p          @reference.static
;   function f(I $i): ?L  catch (E $e)     @reference.type "I", "L", "E"
;   $a instanceof Q                        @reference.instanceof "Q"

(base_clause [(name) (qualified_name) (relative_name)] @reference.extends)

(class_interface_clause [(name) (qualified_name) (relative_name)] @reference.implements)

(use_declaration [(name) (qualified_name) (relative_name)] @reference.trait)

(object_creation_expression [(name) (qualified_name) (relative_name)] @reference.new)

(scoped_call_expression scope: [(name) (qualified_name) (relative_name)] @reference.static)

(scoped_property_access_expression scope: [(name) (qualified_name) (relative_name)] @reference.static)

(class_constant_access_expression . [(name) (qualified_name) (relative_name)] @reference.static)

; Parameter, return, property and catch types, inside nullable, union and
; intersection types too.
(named_type [(name) (qualified_name) (relative_name)] @reference.type)

(binary_expression
  operator: "instanceof"
  right: [(name) (qualified_name) (relative_name)] @reference.instanceof)
