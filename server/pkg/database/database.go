package database

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"ai-girl-battle-server/internal/config"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// Init 初始化数据库连接
// sqlite: 本地开发免安装；mysql: 生产环境
func Init(cfg config.DatabaseConfig) *gorm.DB {
	var (
		db  *gorm.DB
		err error
	)

	switch cfg.Driver {
	case "sqlite":
		// 数据库文件放在 server/data/ 下
		dir := "data"
		if mkErr := os.MkdirAll(dir, 0755); mkErr != nil {
			log.Fatal("创建数据目录失败:", mkErr)
		}
		dsn := filepath.Join(dir, cfg.DBName+".db")
		db, err = gorm.Open(sqlite.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Warn),
		})
	case "mysql":
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.DBName)
		db, err = gorm.Open(mysql.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Warn),
		})
	default:
		log.Fatalf("不支持的 DB_DRIVER: %s（可选 sqlite / mysql）", cfg.Driver)
	}

	if err != nil {
		log.Fatal("数据库连接失败:", err)
	}

	DB = db
	log.Printf("数据库连接成功（driver=%s）", cfg.Driver)
	return db
}

// GetDB 获取数据库实例
func GetDB() *gorm.DB {
	return DB
}
