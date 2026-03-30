package repository

// User represents a user database record.
type User struct {
	ID    int    `db:"id"`
	Name  string `db:"name"`
	Email string `db:"email"`
}

// UserRepository handles user data access.
type UserRepository struct{}

// NewUserRepository creates a new UserRepository.
func NewUserRepository() *UserRepository {
	return &UserRepository{}
}

// FindAll returns all users from the database.
func (r *UserRepository) FindAll() ([]User, error) {
	return []User{
		{ID: 1, Name: "Alice", Email: "alice@example.com"},
		{ID: 2, Name: "Bob", Email: "bob@example.com"},
	}, nil
}
