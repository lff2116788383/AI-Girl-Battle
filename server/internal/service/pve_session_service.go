package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"ai-girl-battle-server/internal/battle"
	"ai-girl-battle-server/internal/model"

	"gorm.io/gorm"
)

// PVEInteractiveService 交互式 PVE：会话制逐回合提交指令。
//
// 架构约定（与 W2 整场重放一致）：敌方指令序列由服务端权威预生成（固定轮转），
// 玩家指令逐回合追加；每回合用纯函数引擎重放"前缀"得到该回合帧与全场快照。
// 回合数 ≤50，重放成本 O(n)，MVP 单实例内存会话即可。
type PVEInteractiveService struct {
	db            *gorm.DB
	configService *ConfigService
	battleService *BattleService

	mu       sync.Mutex
	sessions map[string]*pveSession
}

func NewPVEInteractiveService(db *gorm.DB, configService *ConfigService, battleService *BattleService) *PVEInteractiveService {
	return &PVEInteractiveService{
		db:            db,
		configService: configService,
		battleService: battleService,
		sessions:      map[string]*pveSession{},
	}
}

// sessionTTL 会话有效期（惰性过期：下次操作时清理）
const sessionTTL = 10 * time.Minute

type pveSession struct {
	ID         string
	UserID     uint
	LevelID    string
	Seed       uint32
	Party      []battle.PetInput
	Enemies    []battle.PetInput
	EnemyCmds  []*battle.BattleCommand // 服务端权威预生成，长度 = maxTurns
	PlayerCmds []*battle.BattleCommand // 已提交指令，长度 = 已打回合数
	Turn       int                     // 下一回合号（从 1 开始）
	CreatedAt  time.Time
}

// StartRequest 开局请求
type StartRequest struct {
	LevelID string            `json:"levelId" binding:"required"`
	Seed    uint32            `json:"seed"`
	Party   []battle.PetInput `json:"party" binding:"required"`
}

// Start 开局：校验阵容 → 建会话 → 返回敌方阵容（服务端权威）供客户端渲染
func (s *PVEInteractiveService) Start(userID uint, req *StartRequest) (map[string]interface{}, error) {
	if len(req.Party) == 0 || len(req.Party) > 3 {
		return nil, errors.New("阵容数量非法（1~3）")
	}
	level, err := s.battleService.GetLevel(req.LevelID)
	if err != nil {
		return nil, err
	}

	// 敌方托管指令：与 W4 PVP 一致的轮转策略（服务端权威预生成）
	rulesPkg, err := s.configService.GetKey("battle-rules")
	if err != nil {
		return nil, fmt.Errorf("规则表未入库: %w", err)
	}
	var rules battle.BattleRules
	if err := json.Unmarshal([]byte(rulesPkg.Payload), &rules); err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 惰性清理过期会话
	now := time.Now()
	for id, sess := range s.sessions {
		if now.Sub(sess.CreatedAt) > sessionTTL {
			delete(s.sessions, id)
		}
	}

	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	sess := &pveSession{
		ID: hex.EncodeToString(buf), UserID: userID, LevelID: level.ID,
		Seed: req.Seed, Party: req.Party, Enemies: level.Enemies,
		EnemyCmds: autoEnemyCommands(rules.Turn.MaxTurns),
		Turn:      1, CreatedAt: now,
	}
	s.sessions[sess.ID] = sess

	return map[string]interface{}{
		"sessionId": sess.ID,
		"turn":      sess.Turn,
		"maxTurns":  rules.Turn.MaxTurns,
		"level":     level,
		"party":     req.Party,
	}, nil
}

// CommandRequest 逐回合指令
type CommandRequest struct {
	SessionID string              `json:"sessionId" binding:"required"`
	Command   *battle.BattleCommand `json:"command"` // nil = 跳过
}

// Submit 提交一回合指令：重放前缀 → 返回本回合帧 + 全场快照 + 胜负态
func (s *PVEInteractiveService) Submit(userID uint, req *CommandRequest) (map[string]interface{}, error) {
	s.mu.Lock()
	sess, ok := s.sessions[req.SessionID]
	s.mu.Unlock()
	if !ok {
		return nil, errors.New("会话不存在或已过期")
	}
	if sess.UserID != userID {
		return nil, errors.New("会话不属于当前用户")
	}
	if len(sess.PlayerCmds) >= len(sess.EnemyCmds) {
		return nil, errors.New("回合数已用尽")
	}

	// 追加玩家指令（若此前回合玩家超时未提交，以 nil 补齐）
	for len(sess.PlayerCmds) < sess.Turn-1 {
		sess.PlayerCmds = append(sess.PlayerCmds, nil)
	}
	sess.PlayerCmds = append(sess.PlayerCmds, req.Command)

	// 读规则表
	rulesPkg, err := s.configService.GetKey("battle-rules")
	if err != nil {
		return nil, fmt.Errorf("规则表未入库: %w", err)
	}
	var rules battle.BattleRules
	if err := json.Unmarshal([]byte(rulesPkg.Payload), &rules); err != nil {
		return nil, err
	}

	// 合并双端指令并重放前缀（玩家侧补 nil 到全长度）
	merged := make([][]*battle.BattleCommand, 0, len(sess.EnemyCmds))
	for t := 0; t < len(sess.EnemyCmds); t++ {
		var a *battle.BattleCommand
		if t < len(sess.PlayerCmds) {
			a = sess.PlayerCmds[t]
		}
		merged = append(merged, []*battle.BattleCommand{a, sess.EnemyCmds[t]})
	}
	res := battle.RunBattle(sess.Seed, &rules, sess.Party, sess.Enemies, merged)

	// 本回合帧与快照
	turn := sess.Turn
	turnFrames := make([]battle.Frame, 0, 4)
	for _, f := range res.Frames {
		if f.Turn == turn {
			turnFrames = append(turnFrames, f)
		}
	}
	if turn-1 >= len(res.Snapshots) {
		return nil, errors.New("引擎快照缺失")
	}
	snap := res.Snapshots[turn-1]

	sess.Turn++

	out := map[string]interface{}{
		"turn":     turn,
		"frames":   turnFrames,
		"snapshot": snap,
		"finished": false,
	}

	// 终局：结算奖励 + 战报落库 + 删除会话
	if snap.Winner >= 0 {
		var rewards map[string]int
		level, _ := s.battleService.GetLevel(sess.LevelID)
		if snap.Winner == 0 && level != nil {
			rewards = level.Rewards
			if err := grantRewards(s.db, userID, rewards); err != nil {
				return nil, err
			}
		} else {
			rewards = map[string]int{}
		}
		framesJSON, _ := json.Marshal(res.Frames)
		rewardJSON, _ := json.Marshal(rewards)
		record := model.BattleRecord{
			UserID: userID, LevelID: sess.LevelID, Seed: sess.Seed,
			Result: snap.Winner, TurnCount: res.Result.Turns,
			FramesJSON: string(framesJSON), RewardJSON: string(rewardJSON),
		}
		if err := s.db.Create(&record).Error; err != nil {
			return nil, err
		}
		user, _ := NewUserService(s.db, nil).GetUserByID(userID)

		out["finished"] = true
		out["winner"] = snap.Winner
		out["rewards"] = rewards
		out["recordId"] = record.ID
		out["user"] = user
		out["allFrames"] = res.Frames

		s.mu.Lock()
		delete(s.sessions, req.SessionID)
		s.mu.Unlock()
	}
	return out, nil
}

// Abandon 主动放弃会话
func (s *PVEInteractiveService) Abandon(userID uint, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok {
		return errors.New("会话不存在或已过期")
	}
	if sess.UserID != userID {
		return errors.New("会话不属于当前用户")
	}
	delete(s.sessions, sessionID)
	return nil
}

// autoEnemyCommands 敌方托管指令（服务端权威）：每回合轮转技能 0/1/2
func autoEnemyCommands(turns int) []*battle.BattleCommand {
	cmds := make([]*battle.BattleCommand, 0, turns)
	for t := 0; t < turns; t++ {
		cmds = append(cmds, &battle.BattleCommand{Kind: "skill", Index: t % 3})
	}
	return cmds
}
