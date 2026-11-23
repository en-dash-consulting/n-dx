---
"@n-dx/lang-php": patch
---

With the PHP pack, `outbound.json` now lists the databases and caches PHP code connects to.

Database connections come from `mysql_connect`, `mysqli_connect` and `new mysqli`, `new PDO` (the client names the driver, such as `pdo_mysql`), `pg_connect`, `oci_connect`, `sqlsrv_connect`, `odbc_connect` and Doctrine DBAL's `DriverManager::getConnection`. Cache clients come from Memcache, Memcached and Redis connections and `new Predis\Client`. The target is the host and port when the code spells them out, including inside a DSN or connection string; a user name and password in a connection URL are never recorded. Without the PHP pack, `outbound.json` is unchanged.
