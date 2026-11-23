package handler

import (
	"net/http"
	"strconv"

	"ai-girl-battle-server/internal/service"

	"github.com/gin-gonic/gin"
)

type BattleHandler struct {
	battleService *service.BattleService
}

func NewBattleHandler(battleService *service.BattleService) *BattleHandler {
	return &BattleHandler{battleService: battleService}
}

// ListLevels 关卡列表
func (h *BattleHandler) ListLevels(c *gin.Context) {
	levels, err := h.battleService.ListLevels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok", "data": levels})
}

// PVE 整场托管战斗：seed+阵容+指令序列 → 服务端 Go 引擎重放 → 权威结果+奖励
func (h *BattleHandler) PVE(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var req service.PVERequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	res, err := h.battleService.RunPVE(userID, &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "战斗完成", "data": res})
}

// Capture 捕获结算（PVE 胜利后一次性掷骰锁定）
func (h *BattleHandler) Capture(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	recordID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "recordId 非法"})
		return
	}
	captured, species, err := h.battleService.Capture(userID, uint(recordID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "captured": captured, "speciesId": species})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "捕获结算完成", "data": gin.H{"captured": captured, "speciesId": species}})
}

// GetRecord 战报查询
func (h *BattleHandler) GetRecord(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	recordID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "recordId 非法"})
		return
	}
	record, err := h.battleService.GetRecord(userID, uint(recordID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok", "data": record})
}
