package handler

import (
	"ai-girl-battle-server/internal/middleware"
)

// generateToken 包装中间件包的 JWT 签发（避免 handler 直接依赖 jwt 库细节）
func generateToken(userID uint) (string, error) {
	return middleware.GenerateToken(userID)
}
