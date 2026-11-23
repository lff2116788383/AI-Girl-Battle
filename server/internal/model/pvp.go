package model

import (
	"time"
)

// PvPProfile 异步 PVP 玩家档案：防守阵容 + 天梯积分
// 设计：防守阵容为 JSON 快照（挑战者攻击时由服务端反序列化为 B 侧阵容），
// 积分采用简化 Elo：胜 +25，败 -10，下限 0。
type PvPProfile struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	UserID       uint      `json:"user_id" gorm:"uniqueIndex;not null"`
	DefenseJSON  string    `json:"defense_json" gorm:"type:text"` // 防守阵容（[]PetInput 快照）
	DefenseName  string    `json:"defense_name"`                  // 防守阵容展示名（主战宠物名）
	Score        int       `json:"score" gorm:"default:1000"`     // 天梯积分
	Wins         int       `json:"wins" gorm:"default:0"`
	Losses       int       `json:"losses" gorm:"default:0"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// TableName 显式表名（避免 GORM 把 PvPProfile 映射为 p_vp_profiles）
func (PvPProfile) TableName() string { return "pvp_profiles" }
