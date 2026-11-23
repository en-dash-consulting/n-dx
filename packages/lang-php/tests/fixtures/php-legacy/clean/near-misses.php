<?php
// Each line looks like a legacy construct and is not one: each(), mysql_query(), $s{0}, "${x}".
\App\Util\each($items);
$query->each($callback);
$rows = mysqli_query($link, 'SELECT 1');
echo "Hello {$name}";
echo "Hello {${'name'}} <<{${$key}}>>";
$value = ${'dynamic'};
if ('1' == 1 || ' 2.5 ' == 2.5) {}
$first = $name[0];
$ref = &$other;

class Child extends Base { function load() { $this->extra = 1; } }

#[AllowDynamicProperties]
class Bag { function put() { $this->anything = 1; } }

class Magic { function __set($k, $v) {} function put() { $this->anything = 1; } }

class Modern {
  function __construct() {}
  function Modern() {}
}

class Promoted {
  function __construct(private $id) {}
  function load() { $this->id = 2; }
}
