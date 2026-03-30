package handler

import (
	"encoding/json"
	"net/http"

	"github.com/example/go-project/internal/service"
)

// UserHandler handles HTTP requests for user operations.
type UserHandler struct {
	svc *service.UserService
}

// NewUserHandler creates a new UserHandler.
func NewUserHandler() *UserHandler {
	return &UserHandler{
		svc: service.NewUserService(),
	}
}

// List returns all users as JSON.
func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	users, err := h.svc.ListUsers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(users)
}
