package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"

	"ai-girl-battle-server/internal/battle"
	"ai-girl-battle-server/internal/model"

	"gorm.io/gorm"
)

// BattleService PVE 战斗：服务端用 Go 引擎重放客户端提交的 seed+commands，
// 得到权威结果并发放奖励 / 捕获结算。
type BattleService struct {
	db            *gorm.DB
	configService *ConfigService
}

func NewBattleService(db *gorm.DB, configService *ConfigService) *BattleService {
	return &BattleService{db: db, configService: configService}
}

// LevelDef 关卡定义（configs/levels.json → 配置中心 key=levels）
type LevelDef struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Desc           string         `json:"desc"`
	Order          int            `json:"order"`
	CaptureSpecies string         `json:"captureSpecies"`
	CaptureRate    float64        `json:"captureRate"`
	Rewards        map[string]int `json:"rewards"`
	Enemies        []battle.PetInput `json:"enemies"`
}

type levelPackage struct {
	Levels []LevelDef `json:"levels"`
}

// loadLevels 从配置中心读取关卡表
func (s *BattleService) loadLevels() ([]LevelDef, error) {
	pkg, err := s.configService.GetKey("levels")
	if err != nil {
		return nil, fmt.Errorf("关卡配置未入库: %w", err)
	}
	var lp levelPackage
	if err := json.Unmarshal([]byte(pkg.Payload), &lp); err != nil {
		return nil, err
	}
	return lp.Levels, nil
}

func (s *BattleService) GetLevel(levelID string) (*LevelDef, error) {
	levels, err := s.loadLevels()
	if err != nil {
		return nil, err
	}
	for i := range levels {
		if levels[i].ID == levelID {
			return &levels[i], nil
		}
	}
	return nil, errors.New("关卡不存在: " + levelID)
}

// ListLevels 关卡列表（不含敌方详细数值，客户端也有垫脚片可拉全量）
func (s *BattleService) ListLevels() ([]LevelDef, error) {
	return s.loadLevels()
}

// PVERequest 客户端提交的战斗请求（整场托管：seed + 玩家阵容 + 双方指令序列）
type PVERequest struct {
	LevelID  string                 `json:"levelId" binding:"required"`
	Seed     uint32                 `json:"seed"`
	Party    []battle.PetInput      `json:"party" binding:"required"`
	Commands [][]*battle.BattleCommand `json:"commands"`
}

// PVEResult 战斗结果
type PVEResult struct {
	RecordID  uint             `json:"recordId"`
	Result    int              `json:"result"` // 0=玩家胜 1=负 -1=平
	TurnCount int              `json:"turnCount"`
	Frames    []battle.Frame   `json:"frames"`
	Rewards   map[string]int   `json:"rewards"`
	User      *model.User      `json:"user"` // 更新后的资源
	Level     *LevelDef        `json:"level"`
}

// RunPVE 重放战斗 → 权威结果 → 胜利发放奖励
func (s *BattleService) RunPVE(userID uint, req *PVERequest) (*PVEResult, error) {
	level, err := s.GetLevel(req.LevelID)
	if err != nil {
		return nil, err
	}
	if len(req.Party) == 0 || len(req.Party) > 3 {
		return nil, errors.New("玩家阵容数量非法（1~3）")
	}

	// 读规则表（配置中心 key=battle-rules）
	rulesPkg, err := s.configService.GetKey("battle-rules")
	if err != nil {
		return nil, fmt.Errorf("规则表未入库: %w", err)
	}
	var rules battle.BattleRules
	if err := json.Unmarshal([]byte(rulesPkg.Payload), &rules); err != nil {
		return nil, err
	}

	// 重放（A=玩家，B=关卡敌方阵容，敌方阵容服务端权威）
	res := battle.RunBattle(req.Seed, &rules, req.Party, level.Enemies, req.Commands)

	var rewards map[string]int
	if res.Result.Winner == 0 {
		rewards = level.Rewards
		if err := s.grantRewards(userID, rewards); err != nil {
			return nil, err
		}
	} else {
		rewards = map[string]int{}
	}

	framesJSON, _ := json.Marshal(res.Frames)
	rewardJSON, _ := json.Marshal(rewards)
	record := model.BattleRecord{
		UserID: userID, LevelID: level.ID, Seed: req.Seed,
		Result: res.Result.Winner, TurnCount: res.Result.Turns,
		FramesJSON: string(framesJSON), RewardJSON: string(rewardJSON),
	}
	if err := s.db.Create(&record).Error; err != nil {
		return nil, err
	}

	user, _ := NewUserService(s.db, nil).GetUserByID(userID)
	return &PVEResult{
		RecordID: record.ID, Result: res.Result.Winner,
		TurnCount: res.Result.Turns, Frames: res.Frames,
		Rewards: rewards, User: user, Level: level,
	}, nil
}

// grantRewards 奖励 key 直接映射 User 字段（coins/tokens/feed/ice_packs）
func (s *BattleService) grantRewards(userID uint, rewards map[string]int) error {
	user := &model.User{}
	if err := s.db.First(user, userID).Error; err != nil {
		return err
	}
	if v, ok := rewards["coins"]; ok {
		user.Coins += v
	}
	if v, ok := rewards["tokens"]; ok {
		user.Tokens += v
	}
	if v, ok := rewards["feed"]; ok {
		user.Feed += v
	}
	if v, ok := rewards["ice_packs"]; ok {
		user.IcePacks += v
	}
	return s.db.Save(user).Error
}

// Capture 捕获结算：校验战报归属/胜利/未锁定 → 一次性掷骰锁定结果（防刷）
func (s *BattleService) Capture(userID uint, recordID uint) (captured bool, species string, err error) {
	record := &model.BattleRecord{}
	if err = s.db.First(record, recordID).Error; err != nil {
		return false, "", errors.New("战报不存在")
	}
	if record.UserID != userID {
		return false, "", errors.New("战报不属于当前用户")
	}
	if record.Result != 0 {
		return false, "", errors.New("战斗未胜利，无法捕获")
	}
	if record.Captured != "" {
		return record.Captured != "none", record.Captured, errors.New("该战报的捕获已结算")
	}
	level, err := s.GetLevel(record.LevelID)
	if err != nil {
		return false, "", err
	}
	if level.CaptureSpecies == "" || level.CaptureRate <= 0 {
		return false, "", errors.New("该关卡无法捕获")
	}
	// 一次性锁定
	if rand.Float64() < level.CaptureRate {
		record.Captured = level.CaptureSpecies
	} else {
		record.Captured = "none"
	}
	if err = s.db.Save(record).Error; err != nil {
		return false, "", err
	}
	return record.Captured != "none", record.Captured, nil
}

// GetRecord 战报查询
func (s *BattleService) GetRecord(userID uint, recordID uint) (*model.BattleRecord, error) {
	record := &model.BattleRecord{}
	if err := s.db.First(record, recordID).Error; err != nil {
		return nil, err
	}
	if record.UserID != userID {
		return nil, errors.New("战报不属于当前用户")
	}
	return record, nil
}
