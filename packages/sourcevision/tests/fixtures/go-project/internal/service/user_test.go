package service

import "testing"

func TestUserService_ListUsers(t *testing.T) {
	svc := NewUserService()
	users, err := svc.ListUsers()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(users) == 0 {
		t.Error("expected at least one user")
	}
}
