<?php
use Doctrine\DBAL\DriverManager;

$mysqli = mysqli_connect('mysqli.internal', 'u', 'p', 'shop', 3306);
$oo = new mysqli('crm-db.internal', 'u', 'p', 'crm');
$pg = pg_connect("host=pg.internal port=5432 dbname=warehouse user=etl");
pg_query($pg, 'SELECT * FROM shipments');
pg_prepare($pg, 'by_id', 'SELECT * FROM warehouse.stock WHERE id = $1');
$oracle = oci_connect('scott', 'tiger', '//oracle.internal:1521/ORCL');
oci_parse($oracle, 'SELECT * FROM ledger');
$mssql = sqlsrv_connect('tcp:mssql.internal,1433', ['Database' => 'hr']);
sqlsrv_query($mssql, 'SELECT * FROM employees');
$legacy = odbc_connect('Driver={SQL Server};Server=sql.legacy;Database=hr', 'u', 'p');
odbc_exec($legacy, 'SELECT * FROM payroll');
$dbal = DriverManager::getConnection(['url' => 'mysql://app:secret@dbal.internal/app']);
$other = DriverManager::getConnection(['host' => getenv('DBAL_HOST'), 'port' => 3306]);
$dbal->fetchAllAssociative('SELECT * FROM invoices WHERE paid = ?', [0]);
