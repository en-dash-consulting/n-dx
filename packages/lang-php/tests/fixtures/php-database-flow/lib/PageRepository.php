<?php
// A repository method returns a query result's field; callers dispatch it.
class PageRepository {
    private $db;

    public function __construct() {
        $this->db = new mysqli('db', 'app', '', 'app');
    }

    public function handlerFor($slug) {
        $result = mysqli_query($this->db, "SELECT handler FROM pages WHERE slug = 'home'");
        $row = $result->fetch_assoc();
        return $row['handler'];
    }

    public function dispatch($slug) {
        $handler = $this->handlerFor($slug);
        return $handler();
    }
}

$repo = new PageRepository();
$fn = $repo->handlerFor('home');
call_user_func_array($fn, []);
