package battle

// 战斗规则引擎 Go 版 —— 与 TS 端 BattleEngine.ts 逐条对应。
// PRNG 消耗时机 / 出手顺序 / 伤害公式 / buff 规则见 TS 端文件头注释，双端必须同序。

import "math"

type BattleOutput struct {
	Frames []Frame
	Result BattleResult
	// 每回合末全场快照（交互式战斗逐回合推进用），与 TS 端逐位对拍
	Snapshots []TurnSnapshot `json:"snapshots"`
}

// SnapshotPet 单宠回合末状态快照
type SnapshotPet struct {
	UID    string    `json:"uid"`
	Side   int       `json:"side"`
	Slot   int       `json:"slot"`
	HP     float64   `json:"hp"`
	PP     []float64 `json:"pp"`
	Active bool      `json:"active"`
}

// TurnSnapshot 回合末全场快照
type TurnSnapshot struct {
	Turn   int           `json:"turn"`
	Pets   []SnapshotPet `json:"pets"`
	Winner int           `json:"winner"` // -1=进行中；0/1=终局
}

type frameEvtType string

const (
	evtDamage  = "damage"
	evtHeal    = "heal"
	evtShield  = "shield"
	evtBuffUp  = "attackUp"
	evtSwitch  = "switchIn"
	evtFaint   = "faint"
	evtPPUse   = "ppUse"
	evtNoSkill = "noSkill"
	evtNoSw    = "noSwitch"
)

func makePet(in PetInput, rules *BattleRules) CombatPet {
	maxHp := math.Floor(in.Stats.Cooling * rules.HP.CoolingFactor)
	pp := make([]float64, len(in.Skills))
	for i, id := range in.Skills {
		def, ok := rules.Skills[id]
		if !ok {
			panic("unknown skill: " + id)
		}
		pp[i] = float64(def.PPMax)
	}
	return CombatPet{
		UID:       in.UID,
		Name:      in.Name,
		SpeciesID: in.SpeciesID,
		Element:   in.Element,
		Stats:     in.Stats,
		MaxHP:     maxHp,
		HP:        maxHp,
		Skills:    append([]string(nil), in.Skills...),
		PP:        pp,
		Alive:     true,
	}
}

func newEvent(typ string, side int, petUID string, value float64, skillID string, buffKind string) FrameEvent {
	e := FrameEvent{Type: typ, Side: side, PetUID: petUID, Value: value}
	if skillID != "" {
		s := skillID
		e.SkillID = &s
	}
	if buffKind != "" {
		b := buffKind
		e.BuffKind = &b
	}
	return e
}

// effectiveCompute 计算有效算力（含 attackUp 加算 buff，上限裁剪）
func effectiveCompute(pet *CombatPet, rules *BattleRules) float64 {
	up := 0.0
	for _, b := range pet.Buffs {
		if b.Kind == "attackUp" {
			up += b.Value
		}
	}
	if up > rules.Buff.AttackUpCap {
		up = rules.Buff.AttackUpCap
	}
	return pet.Stats.Compute * (1 + up)
}

// activeIndex 场上存活宠物下标；无则 -1
func activeIndex(side []CombatPet) int {
	for i := range side {
		if side[i].Alive {
			return i
		}
	}
	return -1
}

func strPtr(s string) *string {
	c := s
	return &c
}

func RunBattle(seed uint32, rules *BattleRules, sideA, sideB []PetInput, commands [][]*BattleCommand) BattleOutput {
	prng := NewBattlePRNG(seed)
	sides := [][]CombatPet{
		makeParty(sideA, rules),
		makeParty(sideB, rules),
	}
	var frames []Frame
	var snapshots []TurnSnapshot
	seq := 0
	winner := -1
	playedTurns := 0

	pushFrame := func(turn, side int, petUID, action string, skillID string, events []FrameEvent) {
		f := Frame{
			Turn: turn, Seq: seq, Side: side, PetUID: petUID,
			Action: action, Events: events,
		}
		if skillID != "" {
			f.SkillID = strPtr(skillID)
		}
		frames = append(frames, f)
		seq++
	}

	// 回合末全场快照（不影响 PRNG：纯读取状态），与 TS 端逐位对应
	pushSnapshot := func(turn, finalWinner int) {
		snap := TurnSnapshot{Turn: turn, Pets: make([]SnapshotPet, 0, 6), Winner: finalWinner}
		for sideIdx := 0; sideIdx < 2; sideIdx++ {
			side := sides[sideIdx]
			cur := activeIndex(side)
			for i := range side {
				p := &side[i]
				ppCopy := make([]float64, len(p.PP))
				copy(ppCopy, p.PP)
				snap.Pets = append(snap.Pets, SnapshotPet{
					UID: p.UID, Side: sideIdx, Slot: i, HP: p.HP,
					PP: ppCopy, Active: p.Alive && i == cur,
				})
			}
		}
		snapshots = append(snapshots, snap)
	}

	// 被打死后立即结算替补：返回 false 表示该方全灭
	resolveFaint := func(turn, deadSide int) bool {
		side := sides[deadSide]
		replacement := -1
		for i := range side {
			if side[i].Alive {
				replacement = i
				break
			}
		}
		if replacement < 0 {
			return false
		}
		pet := &side[replacement]
		pushFrame(turn, deadSide, pet.UID, "faint_switch", "", []FrameEvent{
			newEvent(evtSwitch, deadSide, pet.UID, 0, "", ""),
		})
		return true
	}

	for turn := 1; turn <= rules.Turn.MaxTurns; turn++ {
		// -- 1. 校验双方指令 --
		type action struct {
			valid bool
			kind  string // "skill" | "switch" | "skip"
			index int
		}
		actions := make([]action, 2)
		for sideIdx := 0; sideIdx < 2; sideIdx++ {
			var cmd *BattleCommand
			if turn-1 < len(commands) {
				cmd = commands[turn-1][sideIdx]
			}
			side := sides[sideIdx]
			cur := activeIndex(side)
			act := action{valid: false, kind: "skip"}
			if cur >= 0 && cmd != nil {
				if cmd.Kind == "switch" {
					t := cmd.Index
					if t >= 0 && t < len(side) && side[t].Alive && t != cur {
						act = action{valid: true, kind: "switch", index: t}
					}
				} else if cmd.Kind == "skill" {
					pet := &side[cur]
					if cmd.Index >= 0 && cmd.Index < len(pet.Skills) && pet.PP[cmd.Index] > 0 {
						act = action{valid: true, kind: "skill", index: cmd.Index}
					}
				}
			}
			actions[sideIdx] = act
		}

		// -- 2. 出手顺序（仅 2 动作，手动比较，禁止 sort） --
		order := [2]int{0, 1}
		priorityOf := func(sideIdx int) int {
			a := actions[sideIdx]
			if !a.valid {
				return -1
			}
			if a.kind == "switch" {
				return rules.Turn.SwitchPriority
			}
			cur := activeIndex(sides[sideIdx])
			pet := &sides[sideIdx][cur]
			return rules.Skills[pet.Skills[a.index]].Priority
		}
		p0, p1 := priorityOf(0), priorityOf(1)
		if !actions[0].valid && actions[1].valid {
			order[0], order[1] = 1, 0
		} else if actions[0].valid && actions[1].valid {
			first := -1
			if p0 != p1 {
				if p0 > p1 {
					first = 0
				} else {
					first = 1
				}
			} else {
				bw0 := sides[0][activeIndex(sides[0])].Stats.Bandwidth
				bw1 := sides[1][activeIndex(sides[1])].Stats.Bandwidth
				if bw0 != bw1 {
					if bw0 > bw1 {
						first = 0
					} else {
						first = 1
					}
				} else {
					// tie-break：PRNG 消耗点之一
					if prng.Next() < 0.5 {
						first = 0
					} else {
						first = 1
					}
				}
			}
			order[0] = first
			order[1] = 1 - first
		}

		// -- 3. 依次执行动作 --
		battleOver := false
		for oi := 0; oi < 2 && !battleOver; oi++ {
			sideIdx := order[oi]
			act := actions[sideIdx]
			side := sides[sideIdx]
			cur := activeIndex(side)
			if cur < 0 {
				break
			}
			if !act.valid {
				pet := &side[cur]
				pushFrame(turn, sideIdx, pet.UID, "skip", "", []FrameEvent{
					newEvent(evtNoSkill, sideIdx, pet.UID, 0, "", ""),
				})
				continue
			}
			// 二次校验：指令可能基于已被打死的原宠
			if act.kind == "switch" {
				if !(act.index < len(side) && side[act.index].Alive && act.index != cur) {
					pet := &side[cur]
					pushFrame(turn, sideIdx, pet.UID, "skip", "", []FrameEvent{
						newEvent(evtNoSw, sideIdx, pet.UID, 0, "", ""),
					})
					continue
				}
			} else {
				curPet := &side[cur]
				if !(act.index < len(curPet.Skills) && curPet.PP[act.index] > 0) {
					pushFrame(turn, sideIdx, curPet.UID, "skip", "", []FrameEvent{
						newEvent(evtNoSkill, sideIdx, curPet.UID, 0, "", ""),
					})
					continue
				}
			}
			if act.kind == "switch" {
				pet := &side[act.index]
				pushFrame(turn, sideIdx, pet.UID, "switch", "", []FrameEvent{
					newEvent(evtSwitch, sideIdx, pet.UID, 0, "", ""),
				})
				continue
			}
			// skill
			pet := &side[cur]
			skillID := pet.Skills[act.index]
			def := rules.Skills[skillID]
			var events []FrameEvent
			pet.PP[act.index] -= 1
			events = append(events, newEvent(evtPPUse, sideIdx, pet.UID, pet.PP[act.index], skillID, ""))

			if def.Category == "attack" {
				foeSide := sides[1-sideIdx]
				foe := &foeSide[activeIndex(foeSide)]
				eff := rules.TypeChart[def.Element][foe.Element]
				// PRNG 消耗点：攻击命中
				randFactor := rules.Damage.RandMin + prng.Next()*rules.Damage.RandSpan
				base := effectiveCompute(pet, rules)*def.Power/rules.Damage.PowerDivisor + rules.Damage.FlatBonus
				dmg := math.Floor(base*eff*randFactor - foe.Stats.Stability/rules.Damage.DefenseDivisor)
				if dmg < rules.Damage.MinDamage {
					dmg = rules.Damage.MinDamage
				}
				shieldVal := 0.0
				for _, b := range foe.Buffs {
					if b.Kind == "shield" && b.Value > shieldVal {
						shieldVal = b.Value
					}
				}
				if shieldVal > 0 {
					dmg = math.Floor(dmg * (1 - shieldVal))
					if dmg < rules.Damage.MinDamage {
						dmg = rules.Damage.MinDamage
					}
				}
				foe.HP -= dmg
				if foe.HP < 0 {
					foe.HP = 0
				}
				events = append(events, newEvent(evtDamage, 1-sideIdx, foe.UID, dmg, skillID, ""))
				if foe.HP <= 0 {
					foe.Alive = false
					events = append(events, newEvent(evtFaint, 1-sideIdx, foe.UID, 0, "", ""))
					pushFrame(turn, sideIdx, pet.UID, "skill", skillID, events)
					if !resolveFaint(turn, 1-sideIdx) {
						winner = sideIdx
						battleOver = true
					}
					playedTurns = turn
					continue
				}
			} else if def.Effect != nil {
				e := def.Effect
				if e.Kind == "heal" {
					heal := math.Floor(pet.MaxHP * e.Ratio)
					before := pet.HP
					pet.HP += heal
					if pet.HP > pet.MaxHP {
						pet.HP = pet.MaxHP
					}
					events = append(events, newEvent(evtHeal, sideIdx, pet.UID, pet.HP-before, skillID, ""))
				} else if e.Kind == "shield" || e.Kind == "attackUp" {
					value := e.Value
					if e.Kind == "attackUp" && value > rules.Buff.AttackUpCap {
						value = rules.Buff.AttackUpCap
					}
					if e.Kind == "shield" && value > rules.Buff.ShieldCap {
						value = rules.Buff.ShieldCap
					}
					newBuffs := make([]ActiveBuff, 0, len(pet.Buffs)+1)
					for _, b := range pet.Buffs {
						if b.Kind != e.Kind {
							newBuffs = append(newBuffs, b)
						}
					}
					newBuffs = append(newBuffs, ActiveBuff{Kind: e.Kind, Value: value, TurnsLeft: e.Turns})
					pet.Buffs = newBuffs
					events = append(events, newEvent(e.Kind, sideIdx, pet.UID, value, skillID, e.Kind))
				}
			}
			pushFrame(turn, sideIdx, pet.UID, "skill", skillID, events)
			playedTurns = turn
		}

		if battleOver {
			pushSnapshot(turn, winner)
			break
		}

		// -- 4. 回合末 buff 递减（含当回合新加的），归零静默移除 --
		for sideIdx := 0; sideIdx < 2; sideIdx++ {
			cur := activeIndex(sides[sideIdx])
			if cur < 0 {
				continue
			}
			pet := &sides[sideIdx][cur]
			for i := range pet.Buffs {
				pet.Buffs[i].TurnsLeft--
			}
			kept := make([]ActiveBuff, 0, len(pet.Buffs))
			for _, b := range pet.Buffs {
				if b.TurnsLeft > 0 {
					kept = append(kept, b)
				}
			}
			pet.Buffs = kept
		}

		pushSnapshot(turn, -1)
	}

	if winner < 0 {
		sum0, sum1 := 0.0, 0.0
		for i := range sides[0] {
			sum0 += sides[0][i].HP / sides[0][i].MaxHP
		}
		for i := range sides[1] {
			sum1 += sides[1][i].HP / sides[1][i].MaxHP
		}
		if sum0 > sum1 {
			winner = 0
		} else if sum1 > sum0 {
			winner = 1
		} else {
			winner = -1
		}
	}
	return BattleOutput{
		Frames:    frames,
		Result:    BattleResult{Winner: winner, Turns: playedTurns},
		Snapshots: snapshots,
	}
}

func makeParty(in []PetInput, rules *BattleRules) []CombatPet {
	party := make([]CombatPet, len(in))
	for i := range in {
		party[i] = makePet(in[i], rules)
	}
	return party
}
