/**
 * 战斗规则引擎（3v3 回合制）—— 纯逻辑，禁止 import cc。
 *
 * == TS/Go 对拍铁律（Go 端 server/internal/battle/engine.go 逐条对应实现）==
 * 1. PRNG 消耗时机（顺序敏感）：
 *    a) 出手顺序 tie-break：先手值、带宽都相等时消耗 1 次
 *    b) 每次攻击技能命中：消耗 1 次（伤害随机系数 0.85~1.0）
 *    其他动作（switch/heal/buff/skip）不消耗。
 * 2. 出手顺序只有双方各 1 个动作，手动两两比较（不用 sort，避免比较器
 *    多次调用导致 PRNG 消耗错位）：先手值(switch=6) > 带宽 > PRNG。
 * 3. 伤害公式：
 *    base = atk.compute*(1+attackUp) * power / powerDivisor + flatBonus
 *    raw  = base * typeChart * (randMin + prng*randSpan) - def.stability / defenseDivisor
 *    dmg  = floor(raw)，下限 minDamage；defender 有 shield 时
 *    dmg  = floor(dmg * (1 - shield))，再下限 minDamage。
 * 4. maxHp = cooling * coolingFactor。
 * 5. buff 回合末统一递减（含当回合新加的），归零静默移除（无帧无事件）。
 *    同 kind 新 buff 直接替换旧 buff。
 * 6. 宠物被打死时立即结算：有存活替补 → 换上 index 最小的存活者
 *    （faint_switch 帧）；无替补 → 战斗立即结束，该方败。
 * 7. maxTurns 用尽未分胜负 → 比较双方 Σ(hp/maxHp)，高者胜，相等为平(-1)。
 */

import { BattlePRNG } from "./BattlePRNG";
import {
    ActiveBuff,
    BattleCommand,
    BattleInput,
    BattlePetInput,
    BattleResult,
    BattleRules,
    CombatPet,
    Frame,
    FrameEvent,
    SkillDef,
} from "./BattleTypes";

export interface BattleOutput {
    frames: Frame[];
    result: BattleResult;
}

function makePet(input: BattlePetInput, rules: BattleRules): CombatPet {
    const maxHp = Math.floor(input.stats.cooling * rules.hp.coolingFactor);
    const pp = input.skills.map(id => {
        const def = rules.skills[id];
        if (!def) throw new Error("unknown skill: " + id);
        return def.ppMax;
    });
    return {
        uid: input.uid,
        name: input.name,
        speciesId: input.speciesId,
        element: input.element,
        stats: {
            compute: input.stats.compute,
            bandwidth: input.stats.bandwidth,
            stability: input.stats.stability,
            cooling: input.stats.cooling,
        },
        maxHp: maxHp,
        hp: maxHp,
        skills: input.skills.slice(),
        pp: pp,
        buffs: [],
        alive: true,
    };
}

function newEvent(type: string, side: number, petUid: string, value: number, skillId: string | null, buffKind: string | null): FrameEvent {
    return { type: type as FrameEvent["type"], side: side, petUid: petUid, value: value, skillId: skillId, buffKind: buffKind };
}

/** 计算有效算力（含 attackUp 加算 buff，上限 buff.attackUpCap） */
function effectiveCompute(pet: CombatPet, rules: BattleRules): number {
    let up = 0;
    for (const b of pet.buffs) {
        if (b.kind === "attackUp") up += b.value;
    }
    if (up > rules.buff.attackUpCap) up = rules.buff.attackUpCap;
    return pet.stats.compute * (1 + up);
}

/** 找场上存活的宠物下标；无则 -1 */
function activeIndex(side: CombatPet[]): number {
    for (let i = 0; i < side.length; i++) {
        if (side[i].alive) return i;
    }
    return -1;
}

export function runBattle(input: BattleInput): BattleOutput {
    const rules = input.rules;
    const prng = new BattlePRNG(input.seed);
    const sides: [CombatPet[], CombatPet[]] = [
        input.sides[0].map(p => makePet(p, rules)),
        input.sides[1].map(p => makePet(p, rules)),
    ];
    const frames: Frame[] = [];
    let seq = 0;
    let winner = -1;
    let playedTurns = 0;

    const pushFrame = (turn: number, side: number, petUid: string, action: string, skillId: string | null, events: FrameEvent[]) => {
        frames.push({ turn: turn, seq: seq, side: side, petUid: petUid, action: action, skillId: skillId, events: events });
        seq++;
    };

    /** 被打死后立即结算替补：返回 false 表示该方全灭（战斗结束） */
    const resolveFaint = (turn: number, deadSide: number): boolean => {
        const side = sides[deadSide];
        let replacement = -1;
        for (let i = 0; i < side.length; i++) {
            if (side[i].alive) { replacement = i; break; }
        }
        if (replacement < 0) return false;
        const pet = side[replacement];
        pushFrame(turn, deadSide, pet.uid, "faint_switch", null, [
            newEvent("switchIn", deadSide, pet.uid, 0, null, null),
        ]);
        return true;
    };

    for (let turn = 1; turn <= rules.turn.maxTurns; turn++) {
        // -- 1. 校验双方指令，生成动作 --
        // action: {valid, kind:"skill"|"switch"|"skip", index}
        type Action = { valid: boolean; kind: "skill" | "switch" | "skip"; index: number };
        const actions: Action[] = [];
        for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
            const cmd: BattleCommand = turn - 1 < input.commands.length ? input.commands[turn - 1][sideIdx] : null;
            const side = sides[sideIdx];
            const cur = activeIndex(side);
            let act: Action = { valid: false, kind: "skip", index: 0 };
            if (cur >= 0 && cmd) {
                if (cmd.kind === "switch") {
                    const target = cmd.index;
                    if (target >= 0 && target < side.length && side[target].alive && target !== cur) {
                        act = { valid: true, kind: "switch", index: target };
                    }
                } else if (cmd.kind === "skill") {
                    const pet = side[cur];
                    if (cmd.index >= 0 && cmd.index < pet.skills.length && pet.pp[cmd.index] > 0) {
                        act = { valid: true, kind: "skill", index: cmd.index };
                    }
                }
            }
            actions.push(act);
        }

        // -- 2. 决定出手顺序（仅 2 个动作，手动两两比较，禁止 sort） --
        const order: number[] = [0, 1];
        const priorityOf = (sideIdx: number): number => {
            const a = actions[sideIdx];
            if (!a.valid) return -1;
            if (a.kind === "switch") return rules.turn.switchPriority;
            const cur = sides[sideIdx][activeIndex(sides[sideIdx])];
            return rules.skills[cur.skills[a.index]].priority;
        };
        const p0 = priorityOf(0);
        const p1 = priorityOf(1);
        if (!actions[0].valid && actions[1].valid) {
            order[0] = 1; order[1] = 0;
        } else if (actions[0].valid && actions[1].valid) {
            let first = -1;
            if (p0 !== p1) {
                first = p0 > p1 ? 0 : 1;
            } else {
                const bw0 = sides[0][activeIndex(sides[0])].stats.bandwidth;
                const bw1 = sides[1][activeIndex(sides[1])].stats.bandwidth;
                if (bw0 !== bw1) {
                    first = bw0 > bw1 ? 0 : 1;
                } else {
                    // tie-break：唯一 PRNG 消耗点之一
                    first = prng.next() < 0.5 ? 0 : 1;
                }
            }
            order[0] = first;
            order[1] = 1 - first;
        }

        // -- 3. 依次执行动作 --
        let battleOver = false;
        for (let oi = 0; oi < 2 && !battleOver; oi++) {
            const sideIdx = order[oi];
            const act = actions[sideIdx];
            const side = sides[sideIdx];
            const cur = activeIndex(side);
            if (cur < 0) break; // 该方已全灭（理论上打死后已立即结束）

            // 先手打死对手后，后手动作取消 → skip 帧（不消耗 PRNG）
            if (!act.valid) {
                const pet = side[cur];
                pushFrame(turn, sideIdx, pet.uid, "skip", null, [
                    newEvent("noSkill", sideIdx, pet.uid, 0, null, null),
                ]);
                continue;
            }
            // 二次校验：指令可能基于已被打死的原宠（替补参战后技能/PP 可能不同）
            if (act.kind === "switch") {
                if (!(act.index < side.length && side[act.index].alive && act.index !== cur)) {
                    pushFrame(turn, sideIdx, side[cur].uid, "skip", null, [
                        newEvent("noSwitch", sideIdx, side[cur].uid, 0, null, null),
                    ]);
                    continue;
                }
            } else {
                const curPet = side[cur];
                if (!(act.index < curPet.skills.length && curPet.pp[act.index] > 0)) {
                    pushFrame(turn, sideIdx, curPet.uid, "skip", null, [
                        newEvent("noSkill", sideIdx, curPet.uid, 0, null, null),
                    ]);
                    continue;
                }
            }
            if (act.kind === "switch") {
                const pet = side[act.index];
                pushFrame(turn, sideIdx, pet.uid, "switch", null, [
                    newEvent("switchIn", sideIdx, pet.uid, 0, null, null),
                ]);
                continue;
            }
            // skill
            const pet = side[cur];
            const skillId = pet.skills[act.index];
            const def: SkillDef = rules.skills[skillId];
            const events: FrameEvent[] = [];
            pet.pp[act.index] -= 1;
            events.push(newEvent("ppUse", sideIdx, pet.uid, pet.pp[act.index], skillId, null));

            if (def.category === "attack") {
                const foeSide = sides[1 - sideIdx];
                const foe = foeSide[activeIndex(foeSide)];
                const eff = rules.typeChart[def.element][foe.element];
                // PRNG 消耗点：攻击命中
                const randFactor = rules.damage.randMin + prng.next() * rules.damage.randSpan;
                const base = effectiveCompute(pet, rules) * def.power / rules.damage.powerDivisor + rules.damage.flatBonus;
                let dmg = Math.floor(base * eff * randFactor - foe.stats.stability / rules.damage.defenseDivisor);
                if (dmg < rules.damage.minDamage) dmg = rules.damage.minDamage;
                // shield 减伤
                let shieldVal = 0;
                for (const b of foe.buffs) {
                    if (b.kind === "shield" && b.value > shieldVal) shieldVal = b.value;
                }
                if (shieldVal > 0) {
                    dmg = Math.floor(dmg * (1 - shieldVal));
                    if (dmg < rules.damage.minDamage) dmg = rules.damage.minDamage;
                }
                foe.hp -= dmg;
                if (foe.hp < 0) foe.hp = 0;
                events.push(newEvent("damage", 1 - sideIdx, foe.uid, dmg, skillId, null));
                if (foe.hp <= 0) {
                    foe.alive = false;
                    events.push(newEvent("faint", 1 - sideIdx, foe.uid, 0, null, null));
                    pushFrame(turn, sideIdx, pet.uid, "skill", skillId, events);
                    if (!resolveFaint(turn, 1 - sideIdx)) {
                        winner = sideIdx;
                        battleOver = true;
                    }
                    playedTurns = turn;
                    continue;
                }
            } else if (def.effect) {
                const e = def.effect;
                if (e.kind === "heal") {
                    const heal = Math.floor(pet.maxHp * e.ratio);
                    const before = pet.hp;
                    pet.hp = pet.hp + heal;
                    if (pet.hp > pet.maxHp) pet.hp = pet.maxHp;
                    events.push(newEvent("heal", sideIdx, pet.uid, pet.hp - before, skillId, null));
                } else if (e.kind === "shield" || e.kind === "attackUp") {
                    // 同 kind 替换；上限裁剪
                    let value = e.value;
                    if (e.kind === "attackUp" && value > rules.buff.attackUpCap) value = rules.buff.attackUpCap;
                    if (e.kind === "shield" && value > rules.buff.shieldCap) value = rules.buff.shieldCap;
                    const buff: ActiveBuff = { kind: e.kind, value: value, turnsLeft: e.turns };
                    pet.buffs = pet.buffs.filter(b => b.kind !== e.kind);
                    pet.buffs.push(buff);
                    events.push(newEvent(e.kind, sideIdx, pet.uid, value, skillId, e.kind));
                }
            }
            pushFrame(turn, sideIdx, pet.uid, "skill", skillId, events);
            playedTurns = turn;
        }

        if (battleOver) break;

        // -- 4. 回合末：双方场上宠 buff 递减（含当回合新加的），归零静默移除 --
        for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
            const cur = activeIndex(sides[sideIdx]);
            if (cur < 0) continue;
            const pet = sides[sideIdx][cur];
            for (const b of pet.buffs) b.turnsLeft -= 1;
            pet.buffs = pet.buffs.filter(b => b.turnsLeft > 0);
        }
    }

    if (winner < 0) {
        // maxTurns 用尽：比较 HP 百分比总和
        let sum0 = 0, sum1 = 0;
        for (const p of sides[0]) sum0 += p.hp / p.maxHp;
        for (const p of sides[1]) sum1 += p.hp / p.maxHp;
        if (sum0 > sum1) winner = 0;
        else if (sum1 > sum0) winner = 1;
        else winner = -1;
    }
    return { frames: frames, result: { winner: winner, turns: playedTurns } };
}
