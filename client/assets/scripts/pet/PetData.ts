/**
 * PetData —— AI娘数据模型（方案文档 §4.2 pets 表的客户端镜像）
 * 纯数据定义 + 工厂，不依赖 cc，可独立单测。
 */

/** 四维属性（方案文档 §2.3） */
export interface PetStats {
    compute: number;    // 算力 = 攻击
    bandwidth: number;  // 带宽 = 速度
    stability: number;  // 稳定 = 防御/命中
    cooling: number;    // 散热 = 耐久/状态抗性
}

/** 宠物运行时状态 */
export type PetStatus = 'normal' | 'hungry' | 'overheat' | 'sad';

/** 宠物来源：部署（长期培养）/ 租用（有租期） */
export type PetSource = 'deploy' | 'rent';

export interface PetData {
    id: string;
    speciesId: string;
    name: string;
    source: PetSource;
    star: number;               // 星级 1~5
    level: number;
    exp: number;
    mood: number;               // 0~100
    status: PetStatus;
    stats: PetStats;            // 当前实际四维（种族基础 + 升星成长）
    skills: string[];           // 已配置技能 id（≤3，战斗阶段启用）
    rentExpireAt: number;       // 租用到期时间戳（部署宠为 0）
    wagePerDay: number;         // 租用日工资（部署宠为 0）
}

/** 种族定义（对应 pets.json species 节点） */
export interface SpeciesDef {
    name: string;
    desc: string;
    rarity: number;
    element: string;            // 四系：算力/网络/硬件/异常
    art: string;                // 美术资源目录名
    baseStats: PetStats;
    skillPool: string[];
    captureRate: number;
    rentOnly?: boolean;
}

/** 美术资源映射（对应 art/deepseek-girl/manifest.json） */
export const PET_ART = {
    dir: 'art/deepseek-girl',
    anim: {
        normal: { frames: 7, prefix: 'idle' },    // 正常：待机呼吸
        sad: { frames: 6, prefix: 'waiting' },    // 心情低：蔫蔫等待
        hungry: { frames: 6, prefix: 'waiting' }, // 断粮：等待投喂
        overheat: { frames: 8, prefix: 'failed' },// 过热宕机：慌张失败
        working: { frames: 6, prefix: 'review' }, // 工单中：托腮思考
        greeting: { frames: 4, prefix: 'waving' },// 招手
    },
} as const;

let petSeq = 0;

/** 创建一只 AI娘 实例（本地 MVP 工厂；服务端接入后由服务器下发） */
export function makePet(species: SpeciesDef, name: string, source: PetSource, rentDays = 0): PetData {
    petSeq += 1;
    const now = Date.now();
    return {
        id: `pet_${now}_${petSeq}`,
        speciesId: species.name,
        name,
        source,
        star: 1,
        level: 1,
        exp: 0,
        mood: 80,
        status: 'normal',
        stats: { ...species.baseStats },
        skills: species.skillPool.slice(0, 1),
        rentExpireAt: source === 'rent' ? now + rentDays * 86400_000 : 0,
        wagePerDay: source === 'rent' ? 10 : 0,
    };
}
