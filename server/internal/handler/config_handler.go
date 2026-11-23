package handler

import (
	"encoding/json"
	"net/http"

	"ai-girl-battle-server/internal/service"

	"github.com/gin-gonic/gin"
)

type ConfigHandler struct {
	configService *service.ConfigService
}

func NewConfigHandler(configService *service.ConfigService) *ConfigHandler {
	return &ConfigHandler{configService: configService}
}

// GetVersion GET /config/version
func (h *ConfigHandler) GetVersion(c *gin.Context) {
	version, err := h.configService.GetVersion()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config_version": version})
}

// GetAll GET /config/all
func (h *ConfigHandler) GetAll(c *gin.Context) {
	version, configs, err := h.configService.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"config_version": version,
		"configs":        configs,
	})
}

// GetKey GET /config/:key
func (h *ConfigHandler) GetKey(c *gin.Context) {
	p, err := h.configService.GetKey(c.Param("key"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在: " + c.Param("key")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// UpsertKey PUT /config/:key（管理端，AdminAuth 中间件已鉴权）
// 兼容两种请求体：{"payload": "<json字符串>", "remark": "..."} 或直接 PUT 一个 JSON 对象
func (h *ConfigHandler) UpsertKey(c *gin.Context) {
	raw, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取请求体失败"})
		return
	}

	payload := ""
	remark := ""
	// 尝试按 {"payload": ...} 包装格式解析
	var wrapped struct {
		Payload string `json:"payload"`
		Remark  string `json:"remark"`
	}
	if jsonErr := json.Unmarshal(raw, &wrapped); jsonErr == nil && wrapped.Payload != "" {
		payload = wrapped.Payload
		remark = wrapped.Remark
	} else {
		// 直接把请求体当配置内容（去掉外层 data 包装）
		var obj struct {
			Payload json.RawMessage `json:"payload"`
		}
		_ = json.Unmarshal(raw, &obj)
		if obj.Payload != nil {
			payload = string(obj.Payload)
		} else {
			payload = string(raw)
		}
	}
	if payload == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload 为空"})
		return
	}

	p, err := h.configService.UpsertKey(c.Param("key"), payload, remark)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "配置已更新", "data": p})
}
