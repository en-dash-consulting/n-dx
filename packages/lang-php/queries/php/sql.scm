; Calls that take SQL text (src/php-sql.ts): @sql.call is the call, @sql.name
; the function or method name as written, @sql.argument each argument. Names
; are matched in any case, as PHP matches them; which argument is SQL is
; decided by its text (lang-kit's looksLikeSql), not its place.
;
;   mysql_query("SELECT …")        @sql.name "mysql_query"
;   $db->prepare('SELECT …')       @sql.name "prepare"
;   DB::select('select …')         @sql.name "select"

; The mysql, mysqli, pgsql, oci8, sqlsrv and odbc extensions' query and
; prepare functions, and Drupal 7's db_query and db_query_range.
(function_call_expression
  function: [(name) (qualified_name)] @sql.name
  arguments: (arguments (argument) @sql.argument)
  (#match? @sql.name "^\\\\?([Mm][Yy][Ss][Qq][Ll]_[Qq][Uu][Ee][Rr][Yy]|[Mm][Yy][Ss][Qq][Ll]_[Uu][Nn][Bb][Uu][Ff][Ff][Ee][Rr][Ee][Dd]_[Qq][Uu][Ee][Rr][Yy]|[Mm][Yy][Ss][Qq][Ll]_[Dd][Bb]_[Qq][Uu][Ee][Rr][Yy]|[Mm][Yy][Ss][Qq][Ll][Ii]_[Qq][Uu][Ee][Rr][Yy]|[Mm][Yy][Ss][Qq][Ll][Ii]_[Mm][Uu][Ll][Tt][Ii]_[Qq][Uu][Ee][Rr][Yy]|[Mm][Yy][Ss][Qq][Ll][Ii]_[Rr][Ee][Aa][Ll]_[Qq][Uu][Ee][Rr][Yy]|[Mm][Yy][Ss][Qq][Ll][Ii]_[Pp][Rr][Ee][Pp][Aa][Rr][Ee]|[Pp][Gg]_[Qq][Uu][Ee][Rr][Yy]|[Pp][Gg]_[Qq][Uu][Ee][Rr][Yy]_[Pp][Aa][Rr][Aa][Mm][Ss]|[Pp][Gg]_[Pp][Rr][Ee][Pp][Aa][Rr][Ee]|[Pp][Gg]_[Ss][Ee][Nn][Dd]_[Qq][Uu][Ee][Rr][Yy]|[Pp][Gg]_[Ss][Ee][Nn][Dd]_[Qq][Uu][Ee][Rr][Yy]_[Pp][Aa][Rr][Aa][Mm][Ss]|[Pp][Gg]_[Ss][Ee][Nn][Dd]_[Pp][Rr][Ee][Pp][Aa][Rr][Ee]|[Oo][Cc][Ii]_[Pp][Aa][Rr][Ss][Ee]|[Ss][Qq][Ll][Ss][Rr][Vv]_[Qq][Uu][Ee][Rr][Yy]|[Ss][Qq][Ll][Ss][Rr][Vv]_[Pp][Rr][Ee][Pp][Aa][Rr][Ee]|[Oo][Dd][Bb][Cc]_[Ee][Xx][Ee][Cc]|[Oo][Dd][Bb][Cc]_[Dd][Oo]|[Oo][Dd][Bb][Cc]_[Pp][Rr][Ee][Pp][Aa][Rr][Ee]|[Dd][Bb]_[Qq][Uu][Ee][Rr][Yy]|[Dd][Bb]_[Qq][Uu][Ee][Rr][Yy]_[Rr][Aa][Nn][Gg][Ee])$")) @sql.call

; Query, prepare and fetch methods (mysqli, PDO, Doctrine DBAL, Zend_Db,
; Laravel's DB facade) and WordPress's wpdb getters, on any receiver or scope.
(member_call_expression
  name: (name) @sql.name
  arguments: (arguments (argument) @sql.argument)
  (#match? @sql.name "^([Qq][Uu][Ee][Rr][Yy]|[Pp][Rr][Ee][Pp][Aa][Rr][Ee]|[Ee][Xx][Ee][Cc]|[Mm][Uu][Ll][Tt][Ii]_[Qq][Uu][Ee][Rr][Yy]|[Rr][Ee][Aa][Ll]_[Qq][Uu][Ee][Rr][Yy]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Qq][Uu][Ee][Rr][Yy]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Ss][Tt][Aa][Tt][Ee][Mm][Ee][Nn][Tt]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Uu][Pp][Dd][Aa][Tt][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll]|[Ff][Ee][Tt][Cc][Hh][Aa][Ss][Ss][Oo][Cc]|[Ff][Ee][Tt][Cc][Hh][Rr][Oo][Ww]|[Ff][Ee][Tt][Cc][Hh][Oo][Nn][Ee]|[Ff][Ee][Tt][Cc][Hh][Cc][Oo][Ll]|[Ff][Ee][Tt][Cc][Hh][Pp][Aa][Ii][Rr][Ss]|[Ff][Ee][Tt][Cc][Hh][Cc][Oo][Ll][Uu][Mm][Nn]|[Ff][Ee][Tt][Cc][Hh][Aa][Rr][Rr][Aa][Yy]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll][Aa][Ss][Ss][Oo][Cc][Ii][Aa][Tt][Ii][Vv][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ss][Ss][Oo][Cc][Ii][Aa][Tt][Ii][Vv][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll][Nn][Uu][Mm][Ee][Rr][Ii][Cc]|[Ff][Ee][Tt][Cc][Hh][Nn][Uu][Mm][Ee][Rr][Ii][Cc]|[Ff][Ee][Tt][Cc][Hh][Ff][Ii][Rr][Ss][Tt][Cc][Oo][Ll][Uu][Mm][Nn]|[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]|[Ss][Tt][Aa][Tt][Ee][Mm][Ee][Nn][Tt]|[Uu][Nn][Pp][Rr][Ee][Pp][Aa][Rr][Ee][Dd]|[Gg][Ee][Tt]_[Vv][Aa][Rr]|[Gg][Ee][Tt]_[Rr][Oo][Ww]|[Gg][Ee][Tt]_[Cc][Oo][Ll]|[Gg][Ee][Tt]_[Rr][Ee][Ss][Uu][Ll][Tt][Ss])$")) @sql.call

(nullsafe_member_call_expression
  name: (name) @sql.name
  arguments: (arguments (argument) @sql.argument)
  (#match? @sql.name "^([Qq][Uu][Ee][Rr][Yy]|[Pp][Rr][Ee][Pp][Aa][Rr][Ee]|[Ee][Xx][Ee][Cc]|[Mm][Uu][Ll][Tt][Ii]_[Qq][Uu][Ee][Rr][Yy]|[Rr][Ee][Aa][Ll]_[Qq][Uu][Ee][Rr][Yy]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Qq][Uu][Ee][Rr][Yy]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Ss][Tt][Aa][Tt][Ee][Mm][Ee][Nn][Tt]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Uu][Pp][Dd][Aa][Tt][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll]|[Ff][Ee][Tt][Cc][Hh][Aa][Ss][Ss][Oo][Cc]|[Ff][Ee][Tt][Cc][Hh][Rr][Oo][Ww]|[Ff][Ee][Tt][Cc][Hh][Oo][Nn][Ee]|[Ff][Ee][Tt][Cc][Hh][Cc][Oo][Ll]|[Ff][Ee][Tt][Cc][Hh][Pp][Aa][Ii][Rr][Ss]|[Ff][Ee][Tt][Cc][Hh][Cc][Oo][Ll][Uu][Mm][Nn]|[Ff][Ee][Tt][Cc][Hh][Aa][Rr][Rr][Aa][Yy]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll][Aa][Ss][Ss][Oo][Cc][Ii][Aa][Tt][Ii][Vv][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ss][Ss][Oo][Cc][Ii][Aa][Tt][Ii][Vv][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll][Nn][Uu][Mm][Ee][Rr][Ii][Cc]|[Ff][Ee][Tt][Cc][Hh][Nn][Uu][Mm][Ee][Rr][Ii][Cc]|[Ff][Ee][Tt][Cc][Hh][Ff][Ii][Rr][Ss][Tt][Cc][Oo][Ll][Uu][Mm][Nn]|[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]|[Ss][Tt][Aa][Tt][Ee][Mm][Ee][Nn][Tt]|[Uu][Nn][Pp][Rr][Ee][Pp][Aa][Rr][Ee][Dd]|[Gg][Ee][Tt]_[Vv][Aa][Rr]|[Gg][Ee][Tt]_[Rr][Oo][Ww]|[Gg][Ee][Tt]_[Cc][Oo][Ll]|[Gg][Ee][Tt]_[Rr][Ee][Ss][Uu][Ll][Tt][Ss])$")) @sql.call

(scoped_call_expression
  name: (name) @sql.name
  arguments: (arguments (argument) @sql.argument)
  (#match? @sql.name "^([Qq][Uu][Ee][Rr][Yy]|[Pp][Rr][Ee][Pp][Aa][Rr][Ee]|[Ee][Xx][Ee][Cc]|[Mm][Uu][Ll][Tt][Ii]_[Qq][Uu][Ee][Rr][Yy]|[Rr][Ee][Aa][Ll]_[Qq][Uu][Ee][Rr][Yy]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Qq][Uu][Ee][Rr][Yy]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Ss][Tt][Aa][Tt][Ee][Mm][Ee][Nn][Tt]|[Ee][Xx][Ee][Cc][Uu][Tt][Ee][Uu][Pp][Dd][Aa][Tt][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll]|[Ff][Ee][Tt][Cc][Hh][Aa][Ss][Ss][Oo][Cc]|[Ff][Ee][Tt][Cc][Hh][Rr][Oo][Ww]|[Ff][Ee][Tt][Cc][Hh][Oo][Nn][Ee]|[Ff][Ee][Tt][Cc][Hh][Cc][Oo][Ll]|[Ff][Ee][Tt][Cc][Hh][Pp][Aa][Ii][Rr][Ss]|[Ff][Ee][Tt][Cc][Hh][Cc][Oo][Ll][Uu][Mm][Nn]|[Ff][Ee][Tt][Cc][Hh][Aa][Rr][Rr][Aa][Yy]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll][Aa][Ss][Ss][Oo][Cc][Ii][Aa][Tt][Ii][Vv][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ss][Ss][Oo][Cc][Ii][Aa][Tt][Ii][Vv][Ee]|[Ff][Ee][Tt][Cc][Hh][Aa][Ll][Ll][Nn][Uu][Mm][Ee][Rr][Ii][Cc]|[Ff][Ee][Tt][Cc][Hh][Nn][Uu][Mm][Ee][Rr][Ii][Cc]|[Ff][Ee][Tt][Cc][Hh][Ff][Ii][Rr][Ss][Tt][Cc][Oo][Ll][Uu][Mm][Nn]|[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]|[Ss][Tt][Aa][Tt][Ee][Mm][Ee][Nn][Tt]|[Uu][Nn][Pp][Rr][Ee][Pp][Aa][Rr][Ee][Dd]|[Gg][Ee][Tt]_[Vv][Aa][Rr]|[Gg][Ee][Tt]_[Rr][Oo][Ww]|[Gg][Ee][Tt]_[Cc][Oo][Ll]|[Gg][Ee][Tt]_[Rr][Ee][Ss][Uu][Ll][Tt][Ss])$")) @sql.call
