<?php
// CodeIgniter-shaped guard: a class file that ends a direct request.
defined('BASEPATH') OR exit('No direct script access allowed');

require_once __DIR__ . '/helpers.inc.php';

class Model
{
    public function greeting()
    {
        return greet('world');
    }
}
