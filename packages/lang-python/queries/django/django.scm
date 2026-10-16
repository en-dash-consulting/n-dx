; What the Django rules (src/django.ts) need beyond the Python queries: the
; arguments of `path`, `re_path` and `include`, the entries of every list
; and tuple, the URLconf assignments, and import aliases. Run only when
; routes are wanted.
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

; Each entry of a list or tuple (@django.sequence): `urlpatterns` entries,
; inline patterns given to `include`, `include((patterns, app_name))`.
; Comments are captured too; readers skip them.
(list (_) @django.item) @django.sequence
(tuple (_) @django.item) @django.sequence

; @django.assignment spans the statement, @django.target is the name and
; @django.assigned the value:
; - `urlpatterns = …` and `urlpatterns += …`;
; - `ROOT_URLCONF = "…"` in a settings module;
; - a name bound to a list, for `include(name)` and `include((name, "ns"))`;
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
  right: (list) @django.assigned) @django.assignment

(assignment
  left: (identifier) @django.target
  right: (call
    function: (_) @_router) @django.assigned
  (#match? @_router "Router$")) @django.assignment

; `import a.b as c`, `from m import d as e`: @django.alias is the local name
; of the aliased import @django.aliased, whose name the imports query captures.
(aliased_import
  alias: (identifier) @django.alias) @django.aliased
