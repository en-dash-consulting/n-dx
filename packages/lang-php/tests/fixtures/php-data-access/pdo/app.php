<?php
// A PDO application with prepared statements and heredoc SQL.
$pdo = new PDO('mysql:host=db.example.com;port=3307;dbname=shop', $user, $pass);
$stmt = $pdo->prepare('SELECT * FROM products WHERE sku = :sku');
$stmt->execute(['sku' => $sku]);
$pg = new PDO('pgsql:host=' . getenv('PG_HOST') . ';dbname=reports');
$lite = new PDO('sqlite:/var/data/cache.db');
$odbc = new \PDO("odbc:LegacyDSN");
$fromConfig = new PDO($config['dsn']);
$pdo->exec("INSERT INTO audit_log (event) VALUES ('login')");
$query = <<<SQL
SELECT c.name, SUM(o.total)
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE c.region = '{$region}'
GROUP BY c.name
SQL;
$rows = $pdo->query($query);
$pdo->query(<<<'SQL'
    DELETE FROM sessions WHERE expires_at < NOW()
    SQL);
