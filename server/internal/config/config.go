package config

import (
	"os"

	"github.com/joho/godotenv"
)

// Config 全局配置（.env / 环境变量）
type Config struct {
	Server    ServerConfig
	Database  DatabaseConfig
	Redis     RedisConfig
	JWT       JWTConfig
	Wx        WxConfig
	AdminToken string
}

type ServerConfig struct {
	Port string
	Mode string
}

type DatabaseConfig struct {
	// Driver: "sqlite"（本地开发默认，免安装）或 "mysql"（生产）
	Driver   string
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
}

type RedisConfig struct {
	Host     string
	Port     string
	Password string
	DB       int
	// Enabled: false 时服务以无缓存模式运行（本地开发）
	Enabled bool
}

type JWTConfig struct {
	Secret string
	Expire int // 过期时间（小时）
}

type WxConfig struct {
	// AppID/Secret 为空时 wx-login 走开发模拟模式（openid = "dev_" + code）
	AppID  string
	Secret string
}

func Load() *Config {
	godotenv.Load()

	return &Config{
		Server: ServerConfig{
			Port: getEnv("SERVER_PORT", "8800"),
			Mode: getEnv("GIN_MODE", "debug"),
		},
		Database: DatabaseConfig{
			Driver:   getEnv("DB_DRIVER", "sqlite"),
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "3306"),
			User:     getEnv("DB_USER", "root"),
			Password: getEnv("DB_PASSWORD", ""),
			DBName:   getEnv("DB_NAME", "ai_girl_battle"),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnv("REDIS_PORT", "6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       0,
			Enabled:  getEnv("REDIS_ENABLED", "false") == "true",
		},
		JWT: JWTConfig{
			Secret: getEnv("JWT_SECRET", "ai-girl-battle-dev-secret"),
			Expire: envInt("JWT_EXPIRE", 72),
		},
		Wx: WxConfig{
			AppID:  getEnv("WX_APPID", ""),
			Secret: getEnv("WX_SECRET", ""),
		},
		AdminToken: getEnv("ADMIN_TOKEN", "dev-admin-token"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func envInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		n := 0
		for _, ch := range value {
			if ch < '0' || ch > '9' {
				return defaultValue
			}
			n = n*10 + int(ch-'0')
		}
		if n > 0 {
			return n
		}
	}
	return defaultValue
}
