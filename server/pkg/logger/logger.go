package logger

import (
	"log"

	"github.com/sirupsen/logrus"
)

// Init 初始化日志（带颜色控制台输出）
func Init() {
	logrus.SetFormatter(&logrus.TextFormatter{
		FullTimestamp:   true,
		TimestampFormat: "2006-01-02 15:04:05",
	})
	logrus.SetLevel(logrus.InfoLevel)
	log.SetOutput(logrus.StandardLogger().Out)
}
