package repository

import "testing"

func TestUserRepository_FindAll(t *testing.T) {
	repo := NewUserRepository()
	users, err := repo.FindAll()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(users) != 2 {
		t.Errorf("expected 2 users, got %d", len(users))
	}
}
