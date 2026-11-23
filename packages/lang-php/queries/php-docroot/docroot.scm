; What the docroot routes (src/php-docroot.ts) need beyond the PHP queries:
; each top-level statement of a file, and of a braced namespace's body, so a
; file holding only declarations (an included fragment, never a page) can be
; told from a page. Inline HTML outside `<?php … ?>` is a `text` or
; `text_interpolation` statement. Run only when routes are wanted.
(program (_) @docroot.top)

(namespace_definition (compound_statement (_) @docroot.top))
