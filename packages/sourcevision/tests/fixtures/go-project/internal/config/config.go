package config

import "os"

// Config holds application configuration.
type Config struct {
	Port     int
	DBHost   string
	LogLevel string
}

// Load reads configuration from environment variables.
func Load() *Config {
	return &Config{
		Port:     8080,
		DBHost:   getEnv("DB_HOST", "localhost"),
		LogLevel: getEnv("LOG_LEVEL", "info"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
