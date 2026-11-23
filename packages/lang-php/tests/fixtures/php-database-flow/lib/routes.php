<?php
// Loads a route row; the front controller dispatches it.
function get_route($path) {
    $db = new PDO('mysql:host=db;dbname=app');
    $stmt = $db->prepare('SELECT controller, action FROM routes WHERE path = ?');
    $stmt->execute([$path]);
    return $stmt->fetch(PDO::FETCH_ASSOC);
}
