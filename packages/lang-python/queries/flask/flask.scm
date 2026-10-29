; What the Flask rules (src/flask.ts) need beyond the Python queries: the
; arguments of the calls they read, the applications and blueprints a file
; makes, and import aliases. Run only when routes are wanted.
;
; @flask.argument is one argument of a call whose callee ends in a name the
; rules read (`bp.route(…)`, `app.register_blueprint(…)`, `Blueprint(…)`),
; positional or `keyword_argument`; pair it with its call by the innermost
; @call.arguments (calls.scm) that contains it. Inside a keyword argument,
; @flask.keyword is the name and @flask.value the value.
(call
  function: (_) @_function
  arguments: (argument_list
    (_) @flask.argument)
  (#match? @_function "(^|[.])(Flask|Blueprint|route|get|post|put|delete|patch|register_blueprint)$"))

(call
  function: (_) @_function
  arguments: (argument_list
    (keyword_argument
      name: (identifier) @flask.keyword
      value: (_) @flask.value))
  (#match? @_function "(^|[.])(Flask|Blueprint|route|get|post|put|delete|patch|register_blueprint)$"))

; Each entry of a `methods=` list or tuple (@flask.sequence), for
; `route(rule, methods=[…])`. Comments are captured too; readers skip them.
(keyword_argument
  name: (identifier) @_name
  value: [
    (list (_) @flask.item)
    (tuple (_) @flask.item)
  ] @flask.sequence
  (#eq? @_name "methods"))

; A name bound to a new application or blueprint: `app = Flask(__name__)`,
; `bp = Blueprint("admin", __name__, url_prefix="/admin")`.
; @flask.assignment spans the statement, @flask.target is the name,
; @flask.assigned the call.
(assignment
  left: (identifier) @flask.target
  right: (call
    function: (_) @_constructor) @flask.assigned
  (#match? @_constructor "(^|[.])(Flask|Blueprint)$")) @flask.assignment

; `import a.b as c`, `from m import d as e`: @flask.alias is the local name
; of the aliased import @flask.aliased, whose name the imports query captures.
(aliased_import
  alias: (identifier) @flask.alias) @flask.aliased

; Rebindings outside def/class also count under module-level if/try blocks.
(assignment left: (identifier) @flask.binding right: (_))
