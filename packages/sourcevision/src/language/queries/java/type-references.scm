; References to types, by the position they appear in. The capture is the
; whole type as written (`Map<String, List<Order>>`, `java.util.List<T>`).
; Primitive, void and array types are not captured here; the element type of
; an array is still reached through @typeref.name.
;
;   @typeref.field       field type
;   @typeref.parameter   formal, varargs and record-component type
;   @typeref.return      method return type
;   @typeref.extends     class superclass, or each interface an interface extends
;   @typeref.implements  each interface a class, enum or record implements
;   @typeref.annotation  annotation name, marker or with arguments
;   @typeref.new         type in `new T(...)`
;
; @typeref.name is every simple type name, wherever it occurs: it also covers
; type arguments, bounds, throws clauses, casts, local variables and the
; qualifier of a scoped name.
(field_declaration
  type: [(type_identifier) (scoped_type_identifier) (generic_type)] @typeref.field)

(formal_parameter
  type: [(type_identifier) (scoped_type_identifier) (generic_type)] @typeref.parameter)

(spread_parameter
  [(type_identifier) (scoped_type_identifier) (generic_type)] @typeref.parameter)

(method_declaration
  type: [(type_identifier) (scoped_type_identifier) (generic_type)] @typeref.return)

(superclass
  [(type_identifier) (scoped_type_identifier) (generic_type)] @typeref.extends)

(extends_interfaces
  (type_list [(type_identifier) (scoped_type_identifier) (generic_type)] @typeref.extends))

(super_interfaces
  (type_list [(type_identifier) (scoped_type_identifier) (generic_type)] @typeref.implements))

(marker_annotation name: (_) @typeref.annotation)

(annotation name: (_) @typeref.annotation)

(object_creation_expression
  type: [(type_identifier) (scoped_type_identifier) (generic_type)] @typeref.new)

(type_identifier) @typeref.name
