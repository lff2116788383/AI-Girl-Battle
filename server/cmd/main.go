package main

import (
	"log"
	"net/http"
	"os"

	"ai-girl-battle-server/internal/config"
	"ai-girl-battle-server/internal/handler"
	"ai-girl-battle-server/internal/middleware"
	"ai-girl-battle-server/internal/model"
	"ai-girl-battle-server/internal/service"
	"ai-girl-battle-server/pkg/database"

	"github.com/gin-gonic/gin"
)

func main() {
	// 日志 + 配置
	loggerInit()
	cfg := config.Load()

	// 数据库（sqlite/mysql）
	db := database.Init(cfg.Database)
	if err := model.AutoMigrate(db); err != nil {
		log.Fatal("数据库迁移失败:", err)
	}

	// Redis（可选）
	redisClient := database.InitRedis(cfg.Redis)

	// 配置中心：首装种子入库
	configService := service.NewConfigService(db)
	if err := configService.SeedFromDir("configs"); err != nil {
		log.Fatal("配置种子入库失败:", err)
	}

	// 服务与处理器
	userService := service.NewUserService(db, redisClient)
	wxService := service.NewWxService(cfg)
	userHandler := handler.NewUserHandler(userService, wxService)
	configHandler := handler.NewConfigHandler(configService)
	battleService := service.NewBattleService(db, configService)
	battleHandler := handler.NewBattleHandler(battleService)

	// JWT 中间件初始化
	middleware.InitAuth(cfg)

	// Gin 引擎
	if cfg.Server.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(middleware.Logger())
	r.Use(middleware.Recovery())

	setupRoutes(r, userHandler, configHandler, battleHandler, cfg.AdminToken)

	log.Printf("AI中转站服务器启动在端口 %s（DB=%s）", cfg.Server.Port, cfg.Database.Driver)
	if err := r.Run(":" + cfg.Server.Port); err != nil {
		log.Fatal("服务器启动失败:", err)
	}
}

func setupRoutes(r *gin.Engine, userHandler *handler.UserHandler, configHandler *handler.ConfigHandler, battleHandler *handler.BattleHandler, adminToken string) {
	v1 := r.Group("/api/v1")

	// 认证
	auth := v1.Group("/auth")
	{
		auth.POST("/wx-login", userHandler.WxLogin) // 微信小游戏
		auth.POST("/login", userHandler.Login)      // H5 开发直连
	}

	// 用户（资料 + 云存档）
	user := v1.Group("/user")
	user.Use(middleware.Auth())
	{
		user.GET("/profile", userHandler.GetProfile)
		user.PUT("/profile", userHandler.UpdateProfile)
		user.GET("/state", userHandler.GetState)
		user.PUT("/state", userHandler.SaveState)
	}

	// 配置中心（读接口公开，写接口需要管理凭证）
	cfgGroup := v1.Group("/config")
	{
		cfgGroup.GET("/version", configHandler.GetVersion)
		cfgGroup.GET("/all", configHandler.GetAll)
		cfgGroup.GET("/:key", configHandler.GetKey)
		cfgGroup.PUT("/:key", middleware.AdminAuth(adminToken), configHandler.UpsertKey)
	}

	// PVE 战斗 + 捕获
	battle := v1.Group("/battle")
	battle.Use(middleware.Auth())
	{
		battle.GET("/levels", battleHandler.ListLevels)
		battle.POST("/pve", battleHandler.PVE)
		battle.POST("/capture/:id", battleHandler.Capture)
		battle.GET("/record/:id", battleHandler.GetRecord)
	}

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"message": "AI中转站服务器运行正常",
		})
	})
}

func loggerInit() {
	// 日志输出到 stdout，写入文件交给部署层（docker logs / 进程守护）
	if _, err := os.Stdout.Stat(); err != nil {
		log.SetOutput(os.Stderr)
	}
}
