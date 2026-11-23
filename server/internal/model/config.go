package model

import (
	"time"

	"gorm.io/gorm"
)

// ConfigPackage 配置中心：一个 key 对应一份配置包（如 facilities/pets/settlement/battle_rules）
// 服务端权威：客户端启动时比对 configVersion 拉取，运营改数值无需发版。
type ConfigPackage struct {
	ID        uint           `json:"id" gorm:"primaryKey"`
	Key       string         `json:"key" gorm:"uniqueIndex;not null"` // facilities / pets / settlement / ...
	Payload   string         `json:"payload" gorm:"type:text"`        // JSON 内容
	Version   int            `json:"version" gorm:"default:1"`        // 该包自身版本
	Remark    string         `json:"remark"`                          // 修改备注
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"deleted_at" gorm:"index"`
}

// ConfigMeta 全局配置版本（单行表 id=1），任一包更新时递增
type ConfigMeta struct {
	ID            uint      `json:"id" gorm:"primaryKey"`
	ConfigVersion int       `json:"config_version" gorm:"default:1"`
	UpdatedAt     time.Time `json:"updated_at"`
}
