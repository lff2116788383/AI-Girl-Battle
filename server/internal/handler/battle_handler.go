package handler

import (
	"net/http"
	"strconv"

	"ai-girl-battle-server/internal/battle"
	"ai-girl-battle-server/internal/service"

	"github.com/gin-gonic/gin"
)

type BattleHandler struct {
	battleService   *service.BattleService
	pvpService      *service.PvPService
	pveSessionSrv   *service.PVEInteractiveService
}

func NewBattleHandler(battleService *service.BattleService, pvpService *service.PvPService, pveSessionSrv *service.PVEInteractiveService) *BattleHandler {
	return &BattleHandler{battleService: battleService, pvpService: pvpService, pveSessionSrv: pveSessionSrv}
}

// StartPVEInteractive 交互式 PVE 开局：建会话，返回敌方阵容（服务端权威）
func (h *BattleHandler) StartPVEInteractive(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var req service.StartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	res, err := h.pveSessionSrv.Start(userID, &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "会话已创建", "data": res})
}

// CommandPVEInteractive 交互式 PVE 提交一回合指令
func (h *BattleHandler) CommandPVEInteractive(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var req service.CommandRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	res, err := h.pveSessionSrv.Submit(userID, &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok", "data": res})
}

// AbandonPVEInteractive 放弃交互式会话
func (h *BattleHandler) AbandonPVEInteractive(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var req struct {
		SessionID string `json:"sessionId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	if err := h.pveSessionSrv.Abandon(userID, req.SessionID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "会话已放弃"})
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

// SetDefensePVP 上传/更新防守阵容
func (h *BattleHandler) SetDefensePVP(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var req struct {
		Party    []battle.PetInput `json:"party" binding:"required"`
		MainName string            `json:"mainName"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	profile, err := h.pvpService.SetDefense(userID, req.Party, req.MainName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "防守阵容已更新", "data": profile})
}

// ChallengePVP 发起挑战：匹配对手 → Go 引擎重放 → 积分结算
func (h *BattleHandler) ChallengePVP(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var req service.PVPChallengeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误", "details": err.Error()})
		return
	}
	res, err := h.pvpService.Challenge(userID, &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "挑战完成", "data": res})
}

// RankingPVP 排行榜
func (h *BattleHandler) RankingPVP(c *gin.Context) {
	ranks, err := h.pvpService.Ranking()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok", "data": ranks})
}
