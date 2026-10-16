; What the outbound-call rules (src/python-clients.ts) need beyond the Python
; queries: the arguments of the calls they read, the clients a file makes,
; import aliases and environment lookups. Run only when outbound calls are
; wanted.
;
; @clients.argument is one argument of a call whose callee ends in a name
; the rules read (`requests.get(…)`, `channel.basic_publish(…)`,
; `KafkaConsumer(…)`), positional or `keyword_argument`; pair it with its
; call by the innermost @call.arguments (calls.scm) that contains it. Inside
; a keyword argument, @clients.keyword is the name and @clients.value the value.
(call
  function: (_) @_function
  arguments: (argument_list
    (_) @clients.argument)
  (#match? @_function "(^|[.])(get|post|put|patch|delete|head|options|request|urlopen|Request|insecure_channel|secure_channel|produce|subscribe|send|KafkaConsumer|basic_publish|basic_consume|send_task|getenv)$"))

(call
  function: (_) @_function
  arguments: (argument_list
    (keyword_argument
      name: (identifier) @clients.keyword
      value: (_) @clients.value))
  (#match? @_function "(^|[.])(get|post|put|patch|delete|head|options|request|urlopen|Request|insecure_channel|secure_channel|produce|subscribe|send|KafkaConsumer|basic_publish|basic_consume|send_task|getenv)$"))

; Each entry of the topic list or tuple passed to `subscribe(…)`, positional
; or as `topics=` (@clients.sequence). Comments are captured too; readers skip them.
(call
  function: (attribute
    attribute: (identifier) @_method)
  arguments: (argument_list
    [
      (list (_) @clients.item)
      (tuple (_) @clients.item)
    ] @clients.sequence)
  (#eq? @_method "subscribe"))

(call
  function: (attribute
    attribute: (identifier) @_method)
  arguments: (argument_list
    (keyword_argument
      name: (identifier) @_name
      value: [
        (list (_) @clients.item)
        (tuple (_) @clients.item)
      ] @clients.sequence))
  (#eq? @_method "subscribe")
  (#eq? @_name "topics"))

; A name bound to a new client: `session = requests.Session()`,
; `channel = connection.channel()`, and the target of `with … as c:` or
; `async with … as c:`. @clients.assignment spans the binding,
; @clients.target is the name, @clients.assigned the call.
(assignment
  left: (identifier) @clients.target
  right: (call
    function: (_) @_constructor) @clients.assigned
  (#match? @_constructor "(^|[.])(Session|Client|AsyncClient|ClientSession|Request|Producer|Consumer|KafkaProducer|KafkaConsumer|BlockingConnection|SelectConnection|channel|Celery)$")) @clients.assignment

(as_pattern
  (call
    function: (_) @_constructor) @clients.assigned
  alias: (as_pattern_target
    (identifier) @clients.target)
  (#match? @_constructor "(^|[.])(Session|Client|AsyncClient|ClientSession|Request|Producer|Consumer|KafkaProducer|KafkaConsumer|BlockingConnection|SelectConnection|channel|Celery)$")) @clients.assignment

; `import a.b as c`, `from m import d as e`: @clients.alias is the local name
; of the aliased import @clients.aliased, whose name the imports query captures.
(aliased_import
  alias: (identifier) @clients.alias) @clients.aliased

; `os.environ["X"]` and `environ["X"]`: @clients.env is the lookup, a name
; or attribute ending in `environ` subscripted.
(subscript
  value: [
    (attribute)
    (identifier)
  ] @_object
  (#match? @_object "(^|[.])environ$")) @clients.env

; The same subscript assigned or deleted: a write, not a lookup.
(assignment
  left: (subscript
    value: (_) @_object) @clients.env.write
  (#match? @_object "(^|[.])environ$"))

(augmented_assignment
  left: (subscript
    value: (_) @_object) @clients.env.write
  (#match? @_object "(^|[.])environ$"))

(delete_statement
  [
    (subscript
      value: (_) @_object) @clients.env.write
    (expression_list
      (subscript
        value: (_) @_object) @clients.env.write)
  ]
  (#match? @_object "(^|[.])environ$"))
