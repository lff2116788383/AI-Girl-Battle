/**
 * 战斗引擎类型定义 —— 纯逻辑，禁止 import cc（可在 Node 单测 / TS-Go 对拍）。
 *
 * 对拍约定（TS/Go 双端必须逐位一致）：
 * - 所有帧字段显式赋值，不依赖 undefined（可选字段用 null / 0 填充）
 * - 浮点运算仅限 IEEE754 双精度四则运算 + floor，双端结果一致
 * - PRNG 消耗时机见 BattleEngine.ts 注释，双端必须同序
 */

export type Element = "compute" | "network" | "hardware" | "anomaly";
export type SkillCategory = "attack" | "defense" | "status";
export type EffectKind = "shield" | "attackUp" | "heal";

export interface SkillEffect {
    kind: EffectKind;
    /** shield: 减伤比例(0~1)；attackUp: 算力提升比例；heal 不用（用 ratio） */
    value: number;
    /** buff 持续回合数（heal 不用） */
    turns: number;
    /** heal: 恢复 maxHp 比例 */
    ratio: number;
}

export interface SkillDef {
    name: string;
    element: Element;
    category: SkillCategory;
    power: number;
    ppMax: number;
    priority: number;
    accuracy: number;
    effect: SkillEffect | null;
}

export interface Stats {
    compute: number;
    bandwidth: number;
    stability: number;
    cooling: number;
}

export interface BattlePetInput {
    uid: string;
    speciesId: string;
    name: string;
    element: Element;
    stats: Stats;
    /** 技能 id 列表，≤ turn.maxSkillsPerPet */
    skills: string[];
}

export type BattleCommand =
    | { kind: "skill"; index: number }
    | { kind: "switch"; index: number }
    | null;

export interface BattleRules {
    elements: Element[];
    typeChart: { [k in Element]: { [k2 in Element]: number } };
    damage: {
        powerDivisor: number;
        flatBonus: number;
        randMin: number;
        randSpan: number;
        defenseDivisor: number;
        minDamage: number;
    };
    hp: { coolingFactor: number };
    turn: { maxTurns: number; switchPriority: number; maxPartySize: number; maxSkillsPerPet: number };
    buff: { attackUpCap: number; shieldCap: number };
    skills: { [id: string]: SkillDef };
}

export interface BattleInput {
    seed: number;
    rules: BattleRules;
    /** 双方阵容，各 ≤ maxPartySize，首发默认 index 0 */
    sides: [BattlePetInput[], BattlePetInput[]];
    /** commands[turn][side] —— 每回合双方指令；null = 跳过 */
    commands: BattleCommand[][];
}

export interface CombatPet {
    uid: string;
    name: string;
    speciesId: string;
    element: Element;
    stats: Stats;
    maxHp: number;
    hp: number;
    skills: string[];
    pp: number[];
    buffs: ActiveBuff[];
    alive: boolean;
}

export interface ActiveBuff {
    kind: "shield" | "attackUp";
    value: number;
    turnsLeft: number;
}

export type FrameEventType =
    | "damage"
    | "heal"
    | "shield"
    | "attackUp"
    | "switchIn"
    | "faint"
    | "ppUse"
    | "noSkill"
    | "noSwitch";

export interface FrameEvent {
    type: FrameEventType;
    side: number;
    petUid: string;
    /** 数值（伤害/回复/buff 值），无则 0 */
    value: number;
    skillId: string | null;
    buffKind: string | null;
}

export interface Frame {
    /** 回合数，从 1 开始 */
    turn: number;
    /** 全局递增序号，从 0 开始 */
    seq: number;
    /** 动作归属方 0/1 */
    side: number;
    petUid: string;
    /** "skill" | "switch" | "skip" | "faint_switch" */
    action: string;
    skillId: string | null;
    events: FrameEvent[];
}

export interface BattleResult {
    /** 0 = A 胜, 1 = B 胜, -1 = 平 */
    winner: number;
    turns: number;
}
