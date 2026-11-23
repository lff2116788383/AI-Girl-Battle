package handler

import (
	"net/http"

	"ai-girl-battle-server/internal/service"

	"github.com/gin-gonic/gin"
)

type UserHandler struct {
	userService *service.UserService
	wxService   *service.WxService
}

func NewUserHandler(userService *service.UserService, wxService *service.WxService) *UserHandler {
	return &UserHandler{userService: userService, wxService: wxService}
}

type loginRequest struct {
	Code     string                 `json:"code"`     // 微信 code（wx-login 用）
	OpenID   string                 `json:"open_id"`  // H5 开发直连用
	UserInfo map[string]interface{} `json:"user_info"`
}

// WxLogin 微信小游戏登录入口：code → openid → JWT
func (h *UserHandler) WxLogin(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	if req.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 code"})
		return
	}

	openID, err := h.wxService.Code2Session(req.Code)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	h.doLogin(c, openID, req.UserInfo)
}

// Login H5 开发登录（open_id 直连）
func (h *UserHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	h.doLogin(c, req.OpenID, req.UserInfo)
}

func (h *UserHandler) doLogin(c *gin.Context, openID string, userInfo map[string]interface{}) {
	user, err := h.userService.Login(openID, userInfo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "登录失败", "details": err.Error()})
		return
	}
	token, err := generateToken(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "签发token失败", "details": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "登录成功",
		"data": gin.H{
			"token": token,
			"user":  user,
		},
	})
}

// GetProfile 用户资料 + 资源
func (h *UserHandler) GetProfile(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	user, err := h.userService.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok", "data": user})
}

// UpdateProfile 更新用户字段
func (h *UserHandler) UpdateProfile(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	if err := h.userService.UpdateUser(userID, updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, _ := h.userService.GetUserByID(userID)
	c.JSON(http.StatusOK, gin.H{"message": "更新成功", "data": user})
}

// GetState 云存档读取
func (h *UserHandler) GetState(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	state, err := h.userService.GetState(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "存档不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok", "data": state})
}

// SaveState 云存档写入（乐观锁）
func (h *UserHandler) SaveState(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var req struct {
		StateJSON string `json:"state_json" binding:"required"`
		Version   int    `json:"version"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	state, err := h.userService.SaveState(userID, req.StateJSON, req.Version)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "存档成功", "data": state})
}
