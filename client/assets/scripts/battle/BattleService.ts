import { BattleInput, BattleCommand, BattleRules, BattlePetInput, Element } from './engine/BattleTypes';
import { runBattle, BattleOutput } from './engine/BattleEngine';
import type { PetData } from '../pet/PetData';

/**
 * BattleService —— 客户端战斗编排（方案文档 §4.4 方案 B：整场托管）
 *
 * 流程：本地 TS 引擎预演 → 提交 seed+阵容+指令序列 → 服务端 Go 引擎重放
 * → 权威结果/战报/奖励 → 表现层播放服务端战报。
 * 离线时以本地预演结果为准（静默降级）。
 *
 * MVP 策略：托管自动战斗（确定性轮转指令，不含状态感知）；
 * 交互式逐回合指令（引擎需支持中间态喂入）在 W4 引入。
 */

/** 引擎英文 key ↔ 种族表中文标签（pets.json element 用中文） */
const ELEMENT_CN2EN: { [cn: string]: string } = {
    '算力': 'compute',
    '网络': 'network',
    '硬件': 'hardware',
    '异常': 'anomaly',
};

/** 从规则表配置（battle-rules.json）构造引擎规则对象 */
export function rulesFromConfig(cfg: any): BattleRules {
    return cfg as BattleRules; // JSON 结构与 BattleRules 一致
}

export interface LevelDef {
    id: string;
    name: string;
    desc: string;
    order: number;
    captureSpecies: string;
    captureRate: number;
    rewards: { [k: string]: number };
    enemies: BattlePetInput[];
}

export class BattleService {

    /** 从规则表配置（battle-rules.json）构造引擎规则对象 */
    public static rulesFromConfig(cfg: any): BattleRules {
        return cfg as BattleRules; // JSON 结构与 BattleRules 一致
    }

    /** PetData → 引擎战斗输入。speciesDef 由 HomeModel.species 查询（element 为中文标签） */
    public static petToInput(pet: PetData, speciesDef: { name: string; element: string } | null): BattlePetInput {
        return {
            uid: pet.id,
            speciesId: pet.speciesId,
            name: pet.name,
            element: BattleService.elementToKey(speciesDef ? speciesDef.element : '算力'),
            stats: { ...pet.stats },
            skills: pet.skills.length > 0 ? pet.skills.slice(0, 3) : ['ws_keepalive'],
        };
    }

    /**
     * 生成托管指令序列：确定性技能轮转（(turn+1)%3），技能数不足的宠由引擎二次校验 skip 兜底。
     * 双端一致性由「同一 commands 提交服务端重放」保证。
     */
    public static planCommands(maxTurns: number): BattleCommand[][] {
        const commands: BattleCommand[][] = [];
        for (let turn = 1; turn <= maxTurns; turn++) {
            commands.push([
                { kind: 'skill', index: (turn + 1) % 3 },
                { kind: 'skill', index: (turn + 1) % 3 },
            ]);
        }
        return commands;
    }

    /** 本地预演（离线权威 / 在线时先给玩家看结果预期） */
    public static preview(seed: number, rules: BattleRules, party: BattlePetInput[], enemies: BattlePetInput[], commands: BattleCommand[][]): BattleOutput {
        const input: BattleInput = { seed: seed >>> 0, rules, sides: [party, enemies], commands };
        return runBattle(input);
    }

    public static randomSeed(): number {
        return (Date.now() % 4294967296) >>> 0;
    }

    public static elementToKey(cn: string): Element {
        return (ELEMENT_CN2EN[cn] || 'compute') as Element;
    }
}
