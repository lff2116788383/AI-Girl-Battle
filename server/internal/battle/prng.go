package battle

// 可播种 PRNG（mulberry32）—— 必须与 TS 端 BattlePRNG.ts 逐位一致。
// 禁止改动实现或消耗顺序，否则双端对拍全部失效。
type BattlePRNG struct {
	a uint32
}

func NewBattlePRNG(seed uint32) *BattlePRNG {
	return &BattlePRNG{a: seed}
}

// Next 返回 [0, 1) 浮点数
func (p *BattlePRNG) Next() float64 {
	p.a += 0x6D2B79F5
	t := p.a ^ (p.a >> 15)
	t = t * (1 | p.a)
	t = (t + (t^(t>>7))*(t|61)) ^ t
	return float64(t^(t>>14)) / 4294967296.0
}
