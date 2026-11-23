package model

import (
	"log"

	"gorm.io/gorm"
)

// AutoMigrate 自动迁移数据库表
func AutoMigrate(db *gorm.DB) error {
	err := db.AutoMigrate(
		&User{},
		&UserState{},
		&ConfigPackage{},
		&ConfigMeta{},
	)
	if err != nil {
		return err
	}
	// 初始化全局配置版本行
	var meta ConfigMeta
	if err := db.First(&meta, 1).Error; err != nil {
		db.Create(&ConfigMeta{ID: 1, ConfigVersion: 1})
		log.Println("已初始化 ConfigMeta configVersion=1")
	}
	return nil
}
