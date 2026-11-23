<?php
// acme/a requires nothing: Shared\Util is in a path repository only acme/b requires.
new \App\Foo();
new \Mapped();
new \Shared\Util();
new \Lib\Thing();
