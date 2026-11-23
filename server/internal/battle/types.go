// Package battle: 战斗规则引擎 Go 版 —— 与 TS 端 client/assets/scripts/battle/engine 逐位对拍。
// 数值统一用 float64 对应 TS number，保证 IEEE754 运算一致。
package battle

// SkillEffect 技能附带效果
type SkillEffect struct {
	Kind  string  `json:"kind"`
	Value float64 `json:"value"`
	Turns int     `json:"turns"`
	Ratio float64 `json:"ratio"`
}

// SkillDef 技能定义
type SkillDef struct {
	Name     string       `json:"name"`
	Element  string       `json:"element"`
	Category string       `json:"category"`
	Power    float64      `json:"power"`
	PPMax    int          `json:"ppMax"`
	Priority int          `json:"priority"`
	Accuracy int          `json:"accuracy"`
	Effect   *SkillEffect `json:"effect"`
}

// Stats 四维属性
type Stats struct {
	Compute   float64 `json:"compute"`
	Bandwidth float64 `json:"bandwidth"`
	Stability float64 `json:"stability"`
	Cooling   float64 `json:"cooling"`
}

// PetInput 战斗侧宠物输入
type PetInput struct {
	UID       string   `json:"uid"`
	SpeciesID string   `json:"speciesId"`
	Name      string   `json:"name"`
	Element   string   `json:"element"`
	Stats     Stats    `json:"stats"`
	Skills    []string `json:"skills"`
}

// BattleCommand 玩家指令（nil = 跳过）
type BattleCommand struct {
	Kind  string `json:"kind"`
	Index int    `json:"index"`
}

// BattleRules 规则表（由 battle-rules.json 解析）
type BattleRules struct {
	Elements      []string                      `json:"elements"`
	ElementLabels map[string]string             `json:"elementLabels"`
	TypeChart     map[string]map[string]float64 `json:"typeChart"`
	Damage        struct {
		PowerDivisor   float64 `json:"powerDivisor"`
		FlatBonus      float64 `json:"flatBonus"`
		RandMin        float64 `json:"randMin"`
		RandSpan       float64 `json:"randSpan"`
		DefenseDivisor float64 `json:"defenseDivisor"`
		MinDamage      float64 `json:"minDamage"`
	} `json:"damage"`
	HP struct {
		CoolingFactor float64 `json:"coolingFactor"`
	} `json:"hp"`
	Turn struct {
		MaxTurns        int `json:"maxTurns"`
		SwitchPriority  int `json:"switchPriority"`
		MaxPartySize    int `json:"maxPartySize"`
		MaxSkillsPerPet int `json:"maxSkillsPerPet"`
	} `json:"turn"`
	Buff struct {
		AttackUpCap float64 `json:"attackUpCap"`
		ShieldCap   float64 `json:"shieldCap"`
	} `json:"buff"`
	Skills map[string]SkillDef `json:"skills"`
}

// ActiveBuff 宠物身上的持续效果
type ActiveBuff struct {
	Kind      string
	Value     float64
	TurnsLeft int
}

// CombatPet 战斗内宠物实例
type CombatPet struct {
	UID       string
	Name      string
	SpeciesID string
	Element   string
	Stats     Stats
	MaxHP     float64
	HP        float64
	Skills    []string
	PP        []float64
	Buffs     []ActiveBuff
	Alive     bool
}

// FrameEvent 帧（战报/回放最小单元），字段顺序与 TS 端序列化一致
type FrameEvent struct {
	Type     string   `json:"type"`
	Side     int      `json:"side"`
	PetUID   string   `json:"petUid"`
	Value    float64  `json:"value"`
	SkillID  *string  `json:"skillId"`
	BuffKind *string  `json:"buffKind"`
}

// Frame 一条动作帧
type Frame struct {
	Turn    int          `json:"turn"`
	Seq     int          `json:"seq"`
	Side    int          `json:"side"`
	PetUID  string       `json:"petUid"`
	Action  string       `json:"action"`
	SkillID *string      `json:"skillId"`
	Events  []FrameEvent `json:"events"`
}

// BattleResult 战斗结果
type BattleResult struct {
	Winner int `json:"winner"` // 0=A胜 1=B胜 -1=平
	Turns  int `json:"turns"`
}
