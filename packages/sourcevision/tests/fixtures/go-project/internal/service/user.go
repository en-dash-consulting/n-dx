package service

import (
	"github.com/example/go-project/internal/repository"
)

// User represents a user entity.
type User struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// UserService provides user business logic.
type UserService struct {
	repo *repository.UserRepository
}

// NewUserService creates a new UserService.
func NewUserService() *UserService {
	return &UserService{
		repo: repository.NewUserRepository(),
	}
}

// ListUsers returns all users.
func (s *UserService) ListUsers() ([]User, error) {
	return s.repo.FindAll()
}
