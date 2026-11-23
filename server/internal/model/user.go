package model

import (
	"time"

	"gorm.io/gorm"
)

// User 用户模型（AI中转站资源字段）
type User struct {
	ID        uint           `json:"id" gorm:"primaryKey"`
	OpenID    string         `json:"open_id" gorm:"uniqueIndex;not null"`
	Nickname  string         `json:"nickname" gorm:"not null"`
	Avatar    string         `json:"avatar"`
	Level     int            `json:"level" gorm:"default:1"`
	Coins     int            `json:"coins" gorm:"default:1000"`  // 金币
	Tokens    int            `json:"tokens" gorm:"default:50"`   // Token（租用工资货币）
	Feed      int            `json:"feed" gorm:"default:60"`     // 算力饲料
	IcePacks  int            `json:"ice_packs" gorm:"default:1"` // 冰垫（散热救援）
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"deleted_at" gorm:"index"`
}

// UserState 用户云存档（家园状态整体快照，客户端 HomeModel 序列化产物）
// 设计约定：状态字段为 JSON blob，服务端不做结构解析只做存取 —— 结构演进由客户端版本兼容。
type UserState struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	UserID     uint      `json:"user_id" gorm:"uniqueIndex;not null"`
	StateJSON  string    `json:"state_json" gorm:"type:text"` // 家园完整状态（设施/宠物/资源）
	Version    int       `json:"version" gorm:"default:1"`    // 客户端存档版本号，乐观锁防覆盖
	UpdatedAt  time.Time `json:"updated_at"`
}
