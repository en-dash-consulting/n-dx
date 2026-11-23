<?php
// Both apps map App\ to src/ and classmap classes/: each reference stays in this app.
new \App\Foo();
new \App\OnlyA();
new \Mapped();
new \Shared\Util();
new \Lib\Thing();
