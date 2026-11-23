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

// PvPService 异步 PVP：玩家上传防守阵容 → 挑战者攻击（Go 引擎重放）→ 简化 Elo 结算 + 排行榜。
type PvPService struct {
	db            *gorm.DB
	configService *ConfigService
}

func NewPvPService(db *gorm.DB, configService *ConfigService) *PvPService {
	return &PvPService{db: db, configService: configService}
}

// PVPWinScore / PVPLoseScore 简化 Elo 参数（后续可入配置中心）
const (
	PVPWinScore  = 25
	PVPLoseScore = 10
)

// SetDefense 上传/更新防守阵容（1~3 只）
func (s *PvPService) SetDefense(userID uint, party []battle.PetInput, mainName string) (*model.PvPProfile, error) {
	if len(party) == 0 || len(party) > 3 {
		return nil, errors.New("防守阵容数量非法（1~3）")
	}
	defJSON, _ := json.Marshal(party)

	profile := &model.PvPProfile{}
	err := s.db.Where("user_id = ?", userID).First(profile).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		profile = &model.PvPProfile{UserID: userID, Score: 1000}
	} else if err != nil {
		return nil, err
	}
	profile.DefenseJSON = string(defJSON)
	profile.DefenseName = mainName
	if err := s.db.Save(profile).Error; err != nil {
		return nil, err
	}
	return profile, nil
}

// PVPChallengeRequest 挑战请求（无需 levelId，对手由服务端匹配）
type PVPChallengeRequest struct {
	Seed     uint32                    `json:"seed"`
	Party    []battle.PetInput         `json:"party" binding:"required"`
	Commands [][]*battle.BattleCommand `json:"commands"`
}

// Challenge 匹配对手 + 重放战斗 + 积分结算
// 玩家提交 seed+自己的阵容+指令序列；防守方阵容/指令由服务端权威生成
// （防守方托管策略与 PVE 敌方一致：轮转技能，由引擎外生成 commands 传入）。
func (s *PvPService) Challenge(userID uint, req *PVPChallengeRequest) (*PVEResult, error) {
	if len(req.Party) == 0 || len(req.Party) > 3 {
		return nil, errors.New("挑战阵容数量非法（1~3）")
	}

	// 1. 匹配：同积分段随机挑一个非自己的、已上传防守阵容的对手
	opponentProfile, err := s.matchOpponent(userID)
	if err != nil {
		return nil, err
	}

	// 2. 解析防守阵容
	var defense []battle.PetInput
	if err := json.Unmarshal([]byte(opponentProfile.DefenseJSON), &defense); err != nil {
		return nil, fmt.Errorf("对手防守阵容损坏: %w", err)
	}

	// 3. 读规则表
	rulesPkg, err := s.configService.GetKey("battle-rules")
	if err != nil {
		return nil, fmt.Errorf("规则表未入库: %w", err)
	}
	var rules battle.BattleRules
	if err := json.Unmarshal([]byte(rulesPkg.Payload), &rules); err != nil {
		return nil, err
	}

	// 4. 合并指令：commands[turn][0]=挑战者指令（客户端提交），commands[turn][1]=防守方托管
	merged := mergeCommands(req.Commands, autoCommands(20))

	// 5. 重放（A=挑战者，B=防守方）
	res := battle.RunBattle(req.Seed, &rules, req.Party, defense, merged)

	// 6. 积分结算（简化 Elo）
	winner := res.Result.Winner
	attacker := &model.PvPProfile{}
	if err := s.db.Where("user_id = ?", userID).First(attacker).Error; err != nil {
		return nil, errors.New("请先上传防守阵容再参与挑战")
	}
	defenderDelta := 0
	if winner == 0 {
		attacker.Score += PVPWinScore
		attacker.Wins++
		defenderDelta = -PVPLoseScore
	} else if winner == 1 {
		attacker.Score -= PVPLoseScore
		attacker.Losses++
		defenderDelta = +PVPWinScore
	}
	if attacker.Score < 0 {
		attacker.Score = 0
	}

	// 防守方档案同步积分（若对手也已有档案；防守失败时 Losses 记账由对方下次上线感知）
	defender := &model.PvPProfile{}
	if err := s.db.First(defender, opponentProfile.ID).Error; err == nil {
		defender.Score += defenderDelta
		if defender.Score < 0 {
			defender.Score = 0
		}
		if winner == 0 {
			defender.Losses++
		} else if winner == 1 {
			defender.Wins++
		}
		_ = s.db.Save(defender).Error
	}
	if err := s.db.Save(attacker).Error; err != nil {
		return nil, err
	}

	// 7. 战报落库（LevelID 记为 pvp_vs_<对手uid>）
	var rewards map[string]int
	if winner == 0 {
		rewards = map[string]int{"coins": 30, "tokens": 5}
		if err := grantRewards(s.db, userID, rewards); err != nil {
			return nil, err
		}
	} else {
		rewards = map[string]int{}
	}
	framesJSON, _ := json.Marshal(res.Frames)
	rewardJSON, _ := json.Marshal(rewards)
	record := model.BattleRecord{
		UserID: userID, LevelID: fmt.Sprintf("pvp_vs_%d", opponentProfile.UserID), Seed: req.Seed,
		Result: winner, TurnCount: res.Result.Turns,
		FramesJSON: string(framesJSON), RewardJSON: string(rewardJSON),
	}
	if err := s.db.Create(&record).Error; err != nil {
		return nil, err
	}

	user, _ := NewUserService(s.db, nil).GetUserByID(userID)
	opponentUser, _ := NewUserService(s.db, nil).GetUserByID(opponentProfile.UserID)
	opName := "未知对手"
	if opponentUser != nil {
		opName = opponentUser.Nickname
	}
	return &PVEResult{
		RecordID: record.ID, Result: winner,
		TurnCount: res.Result.Turns, Frames: res.Frames,
		Rewards: rewards, User: user,
		Level: &LevelDef{
			ID:      fmt.Sprintf("pvp_vs_%d", opponentProfile.UserID),
			Name:    fmt.Sprintf("挑战 %s（积分 %d）", opName, opponentProfile.Score),
			Enemies: defense, // 供客户端表现层渲染血条（防守方阵容权威快照）
		},
	}, nil
}

// matchOpponent 匹配积分差 ≤300 的随机对手；不足时放宽到任意有防守阵容的对手
func (s *PvPService) matchOpponent(userID uint) (*model.PvPProfile, error) {
	self := &model.PvPProfile{}
	if err := s.db.Where("user_id = ?", userID).First(self).Error; err != nil {
		return nil, errors.New("请先上传防守阵容再参与挑战")
	}
	var candidates []model.PvPProfile
	if err := s.db.Where("user_id <> ? AND defense_json <> '' AND ABS(score - ?) <= 300",
		userID, self.Score).Limit(20).Find(&candidates).Error; err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		if err := s.db.Where("user_id <> ? AND defense_json <> ''", userID).
			Limit(20).Find(&candidates).Error; err != nil {
			return nil, err
		}
	}
	if len(candidates) == 0 {
		return nil, errors.New("暂时没有可挑战的对手")
	}
	return &candidates[rand.Intn(len(candidates))], nil
}

// Ranking 排行榜（前 50）
func (s *PvPService) Ranking() ([]map[string]interface{}, error) {
	type row struct {
		model.PvPProfile
		Nickname string `json:"nickname"`
	}
	var rows []row
	if err := s.db.Table("pvp_profiles").
		Select("pvp_profiles.*, users.nickname").
		Joins("LEFT JOIN users ON users.id = pvp_profiles.user_id").
		Order("score DESC").Limit(50).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		out = append(out, map[string]interface{}{
			"userId": r.UserID, "nickname": r.Nickname, "score": r.Score,
			"wins": r.Wins, "losses": r.Losses, "defenseName": r.DefenseName,
		})
	}
	return out, nil
}

// autoCommands 生成防守方托管指令序列（turns 回合，每回合一条指令，轮转技能 0/1/2）
func autoCommands(turns int) []*battle.BattleCommand {
	cmds := make([]*battle.BattleCommand, 0, turns)
	for t := 0; t < turns; t++ {
		cmds = append(cmds, &battle.BattleCommand{Kind: "skill", Index: t % 3})
	}
	return cmds
}

// mergeCommands 合并双端指令：A 侧取客户端提交（不足回合补 nil=跳过），B 侧取服务端托管
func mergeCommands(attacker [][]*battle.BattleCommand, defender []*battle.BattleCommand) [][]*battle.BattleCommand {
	turns := len(defender)
	if len(attacker) > turns {
		turns = len(attacker)
	}
	out := make([][]*battle.BattleCommand, 0, turns)
	for t := 0; t < turns; t++ {
		var a *battle.BattleCommand
		if t < len(attacker) && len(attacker[t]) > 0 {
			a = attacker[t][0]
		}
		var d *battle.BattleCommand
		if t < len(defender) {
			d = defender[t]
		}
		out = append(out, []*battle.BattleCommand{a, d})
	}
	return out
}
