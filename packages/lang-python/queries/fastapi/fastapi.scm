; What the FastAPI rules (src/fastapi.ts) need beyond the Python queries:
; the arguments of the calls they read, the routers and applications a file
; makes, and import aliases. Run only when routes are wanted.
;
; @fastapi.argument is one argument of a call whose callee ends in a name
; the rules read (`router.get(…)`, `app.include_router(…)`, `APIRouter(…)`),
; positional or `keyword_argument`; pair it with its call by the innermost
; @call.arguments (calls.scm) that contains it. Inside a keyword argument,
; @fastapi.keyword is the name and @fastapi.value the value.
(call
  function: (_) @_function
  arguments: (argument_list
    (_) @fastapi.argument)
  (#match? @_function "(^|[.])(FastAPI|APIRouter|get|post|put|delete|patch|options|head|api_route|include_router|mount)$"))

(call
  function: (_) @_function
  arguments: (argument_list
    (keyword_argument
      name: (identifier) @fastapi.keyword
      value: (_) @fastapi.value))
  (#match? @_function "(^|[.])(FastAPI|APIRouter|get|post|put|delete|patch|options|head|api_route|include_router|mount)$"))

; Each entry of a `methods=` list or tuple (@fastapi.sequence), for
; `api_route(path, methods=[…])`. Comments are captured too; readers skip them.
(keyword_argument
  name: (identifier) @_name
  value: [
    (list (_) @fastapi.item)
    (tuple (_) @fastapi.item)
  ] @fastapi.sequence
  (#eq? @_name "methods"))

; A name bound to a new application or router: `app = FastAPI(…)`,
; `router: APIRouter = APIRouter(prefix="/items")`. @fastapi.assignment
; spans the statement, @fastapi.target is the name, @fastapi.assigned the call.
(assignment
  left: (identifier) @fastapi.target
  right: (call
    function: (_) @_constructor) @fastapi.assigned
  (#match? @_constructor "(^|[.])(FastAPI|APIRouter)$")) @fastapi.assignment

; `import a.b as c`, `from m import d as e`: @fastapi.alias is the local name
; of the aliased import @fastapi.aliased, whose name the imports query captures.
(aliased_import
  alias: (identifier) @fastapi.alias) @fastapi.aliased

; Rebindings outside def/class also count under module-level if/try blocks.
(assignment left: (identifier) @fastapi.binding right: (_))
