<?php
$class = 'Controller_' . $name;
$controller = new $class($request);
$plain = new ArrayObject();
