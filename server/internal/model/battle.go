package model

import "time"

// BattleRecord PVE/PVP 战报记录
// MVP 说明：PVE 玩家阵容由客户端提交（宠物存档暂为 blob），敌方阵容服务端权威；
// 服务端用 Go 战斗引擎重放 seed+commands 得到权威结果。宠物入库后启用严格校验。
type BattleRecord struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	UserID     uint      `json:"user_id" gorm:"index;not null"`
	LevelID    string    `json:"level_id" gorm:"not null"`
	Seed       uint32    `json:"seed"`
	Result     int       `json:"result"`  // 引擎 winner：0=玩家胜 1=敌方胜 -1=平
	TurnCount  int       `json:"turn_count"`
	FramesJSON string    `json:"frames_json" gorm:"type:text"` // 帧列表战报（回放/表现层用）
	RewardJSON string    `json:"reward_json" gorm:"type:text"` // 实发奖励快照
	Captured   string    `json:"captured" gorm:"default:''"`   // 捕获结果：""=未结算 speciesId=捕获 "none"=未捕获（已锁定）
	CreatedAt  time.Time `json:"created_at"`
}
