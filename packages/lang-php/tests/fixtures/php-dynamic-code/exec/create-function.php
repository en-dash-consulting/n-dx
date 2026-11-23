<?php
$add = create_function('$a, $b', 'return $a + $b;');
$sort = function ($field) {
    return create_function('$a, $b', "return strcmp(\$a[$field], \$b[$field]);");
};
