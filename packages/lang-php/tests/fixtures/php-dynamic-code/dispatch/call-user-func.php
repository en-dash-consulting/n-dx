<?php
class Router
{
    public function handle($name, array $args)
    {
        call_user_func([$this, $name]);
        call_user_func_array($name, $args);
        call_user_func([$this, 'save']);
        call_user_func('strtolower', 'X');
        call_user_func(function () { return 1; });
        forward_static_call_array([self::class, $name], $args);
    }

    public function save()
    {
    }
}
