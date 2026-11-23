<?php
namespace App {
    use function Helpers\mysql_query;
    use function Helpers\call_user_func;

    mysql_query('SELECT 1');
    call_user_func($handler);
}

namespace Jobs {
    use function mysql_query as query;
    use function call_user_func as run;

    query('SELECT 1');
    run($handler);
    mysql_query('SELECT 2');
}
