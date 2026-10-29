; What the Django rules (src/django.ts) need beyond the Python queries: the
; arguments of `path`, `re_path` and `include`, the pattern lists and
; include() tuples, the URLconf assignments, and import aliases. Run only
; when routes are wanted.
;
; @django.argument is one argument of a `path(…)`, `re_path(…)` or
; `include(…)` call, positional or `keyword_argument`; pair it with its call
; by the innermost @call.arguments (calls.scm) that contains it. Inside a
; keyword argument, @django.keyword is the name and @django.value the value.
(call
  function: (_) @_function
  arguments: (argument_list
    (_) @django.argument)
  (#match? @_function "(^|[.])(path|re_path|include)$"))

(call
  function: (_) @_function
  arguments: (argument_list
    (keyword_argument
      name: (identifier) @django.keyword
      value: (_) @django.value))
  (#match? @_function "(^|[.])(path|re_path|include)$"))

; Sequences (@django.sequence) and their entries (@django.item), only where
; URL patterns can be, so a data table costs nothing:
; - a list holding a `path(…)` or `re_path(…)` call, and those calls as its
;   entries (`urlpatterns`, its `+` operands, a list bound to a name, an
;   inline `include([...])`); the rules read no other entry;
; - a tuple given to `include`, every entry, for `include((patterns, app_name))`.
(list
  (call
    function: (_) @_pattern) @django.item
  (#match? @_pattern "(^|[.])(path|re_path)$")) @django.sequence

(call
  function: (_) @_function
  arguments: (argument_list
    [
      (tuple (_) @django.item) @django.sequence
      (keyword_argument
        value: (tuple (_) @django.item) @django.sequence)
    ])
  (#match? @_function "(^|[.])include$"))

; @django.assignment spans the statement, @django.target is the name and
; @django.assigned the value:
; - `urlpatterns = …` and `urlpatterns += …`;
; - `ROOT_URLCONF = "…"` in a settings module;
; - a name bound to a list holding a `path(…)` or `re_path(…)` call, for
;   `include(name)` and `include((name, "ns"))`;
; - a name bound to a router, `router = DefaultRouter()`, whose `register`
;   calls are counted, not expanded.
(assignment
  left: (identifier) @django.target
  right: (_) @django.assigned
  (#any-of? @django.target "urlpatterns" "ROOT_URLCONF")) @django.assignment

(augmented_assignment
  left: (identifier) @django.target
  operator: "+="
  right: (_) @django.assigned
  (#eq? @django.target "urlpatterns")) @django.assignment

(assignment
  left: (identifier) @django.target
  right: (list
    (call
      function: (_) @_pattern)) @django.assigned
  (#match? @_pattern "(^|[.])(path|re_path)$")) @django.assignment

(assignment
  left: (identifier) @django.target
  right: (call
    function: (_) @_router) @django.assigned
  (#match? @_router "Router$")) @django.assignment

; @django.self is `urlpatterns` as an operand of `+`, a call's argument or
; unpacked in a list (`urlpatterns + static(…)`,
; `format_suffix_patterns(urlpatterns)`, `[*urlpatterns, path(…)]`): a
; `urlpatterns` assignment holding one keeps the entries before it. An
; unpacking also captures its `*urlpatterns` as @django.splat, where the
; entries before it go.
(binary_operator
  left: (identifier) @django.self
  operator: "+"
  (#eq? @django.self "urlpatterns"))

(binary_operator
  operator: "+"
  right: (identifier) @django.self
  (#eq? @django.self "urlpatterns"))

(argument_list
  [
    (identifier) @django.self
    (keyword_argument
      value: (identifier) @django.self)
  ]
  (#eq? @django.self "urlpatterns"))

(list
  (list_splat
    (identifier) @django.self) @django.splat
  (#eq? @django.self "urlpatterns"))

; `import a.b as c`, `from m import d as e`: @django.alias is the local name
; of the aliased import @django.aliased, whose name the imports query captures.
(aliased_import
  alias: (identifier) @django.alias) @django.aliased

; Rebindings outside def/class also count under module-level if/try blocks.
(assignment left: (identifier) @django.binding right: (_))
