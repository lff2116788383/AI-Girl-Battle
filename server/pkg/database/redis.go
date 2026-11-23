package database

import (
	"context"
	"log"

	"ai-girl-battle-server/internal/config"

	"github.com/go-redis/redis/v8"
)

var RedisClient *redis.Client

// InitRedis 初始化 Redis 连接。
// Redis 在本项目里只做缓存/会话加速，是可选项：
// 未启用或连接失败时返回 nil，服务层必须容忍 nil（降级为直查数据库）。
func InitRedis(cfg config.RedisConfig) *redis.Client {
	if !cfg.Enabled {
		log.Println("Redis 未启用（REDIS_ENABLED != true），以无缓存模式运行")
		return nil
	}

	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Host + ":" + cfg.Port,
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	ctx, cancel := context.WithTimeout(context.Background(), pingTimeout)
	defer cancel()
	if _, err := client.Ping(ctx).Result(); err != nil {
		log.Println("警告: Redis 连接失败，降级为无缓存模式:", err)
		return nil
	}

	RedisClient = client
	log.Println("Redis 连接成功")
	return client
}

const pingTimeout = 3e9 // 3s

// GetRedis 获取 Redis 客户端（可能为 nil）
func GetRedis() *redis.Client {
	return RedisClient
}
