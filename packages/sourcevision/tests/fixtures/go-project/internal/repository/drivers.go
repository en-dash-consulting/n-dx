package repository

import (
	"database/sql"

	// Register the Postgres driver for database/sql.
	_ "github.com/lib/pq"
)

// OpenPostgres opens a PostgreSQL connection using the lib/pq driver.
func OpenPostgres(dsn string) (*sql.DB, error) {
	return sql.Open("postgres", dsn)
}
