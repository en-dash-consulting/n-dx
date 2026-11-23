<?php
class Front
{
    public function run($controller, $action)
    {
        $controller->$action();
        $controller->{'do' . $action}();
        $controller->index();
    }
}
