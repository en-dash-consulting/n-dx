package repository

import "github.com/jmoiron/sqlx"

// DB holds the database connection pool.
var db *sqlx.DB

// SetDB configures the database connection used by repositories.
func SetDB(conn *sqlx.DB) {
	db = conn
}
