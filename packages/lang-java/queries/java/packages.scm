; The file's package declaration. Absent for the default package.
; @package.name is the dotted name; annotations on the package (package-info.java)
; are not part of it.
(package_declaration
  [(identifier) (scoped_identifier)] @package.name) @package.declaration
