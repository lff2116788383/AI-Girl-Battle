package middleware

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"ai-girl-battle-server/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret []byte
var jwtExpire int

// InitAuth 注入 JWT 配置
func InitAuth(cfg *config.Config) {
	jwtSecret = []byte(cfg.JWT.Secret)
	jwtExpire = cfg.JWT.Expire
}

// GenerateToken 签发 JWT
func GenerateToken(userID uint) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Duration(jwtExpire) * time.Hour).Unix(),
		"iat":     time.Now().Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
}

// ParseToken 解析 JWT
func ParseToken(tokenStr string) (uint, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("非法签名算法")
		}
		return jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return 0, errors.New("token 无效或已过期")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, errors.New("claims 解析失败")
	}
	uidFloat, ok := claims["user_id"].(float64)
	if !ok {
		return 0, errors.New("claims 缺少 user_id")
	}
	return uint(uidFloat), nil
}

// Auth JWT 认证中间件
func Auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "缺少认证token"})
			c.Abort()
			return
		}
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token格式错误（应为 Bearer <token>）"})
			c.Abort()
			return
		}
		userID, err := ParseToken(parts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			c.Abort()
			return
		}
		c.Set("user_id", userID)
		c.Next()
	}
}

// AdminAuth 管理端鉴权（配置中心写接口用）
func AdminAuth(adminToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("X-Admin-Token") != adminToken {
			c.JSON(http.StatusForbidden, gin.H{"error": "管理凭证无效"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// CORS 跨域中间件
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, X-Admin-Token")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// Logger 请求日志
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		if c.Request.URL.Path != "/health" {
			gin.DefaultWriter.Write([]byte(
				//nolint
				formatRequestLog(c, start)))
		}
	}
}

func formatRequestLog(c *gin.Context, start time.Time) string {
	return c.Request.Method + " " + c.Request.URL.Path +
		" -> " + http.StatusText(c.Writer.Status()) +
		" (" + time.Since(start).Round(time.Millisecond).String() + ")\n"
}

// Recovery panic 恢复
func Recovery() gin.HandlerFunc {
	return gin.Recovery()
}
