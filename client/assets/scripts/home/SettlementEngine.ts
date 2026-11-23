/**
 * SettlementEngine —— 每日维护结算引擎（方案文档 §2.6 / §4.4）
 *
 * ⚠️ 纯函数：不 import cc、不碰存储、不用 Math.random（用可播种 PRNG）。
 * 服务端 Go 版必须按同一份规则实现并对拍（方案文档 §4.4 / 风险#1）。
 */

/** 设施等级快照 */
export interface FacilityLevels {
    dormitory: number;  // 宿舍：床位
    power: number;      // 电闸：供电上限
    fan: number;        // 风扇：散热容量
    kitchen: number;    // 小厨房：饲料产能
}

/** 资源快照 */
export interface Resources {
    gold: number;
    token: number;
    food: number;
    parts: number;
    coolPads: number;
}

/** 参与结算的宠物最小信息 */
export interface SettlementPet {
    id: string;
    name: string;
    source: 'deploy' | 'rent';
    status: string;
    mood: number;
}

/** 设施配置（由 facilities.json + pets.json upkeep 合成） */
export interface SettlementConfig {
    beds: number[];
    supply: number[];
    cooling: number[];
    foodPerDay: number[];
    powerPerDeployed: number;
    powerPerRented: number;
    heatPerDeployed: number;
    heatPerRented: number;
    foodPerDeployed: number;
    wagePerRented: number;
    goldPerPowerUnit: number;
    maxOfflineDays: number;
    offlineGoldPerDay: number;
    tripHaltHours: number;
    moodDecayNoBed: number;
    moodSadThreshold: number;
}

/** 结算输入 */
export interface SettlementInput {
    facilities: FacilityLevels;
    pets: SettlementPet[];
    resources: Resources;
    /** 距上次结算经过的天数（支持离线多天） */
    daysElapsed: number;
    /** 随机种子（确定性要求） */
    seed: number;
}

/** 账单条目 */
export interface BillLine {
    item: string;
    delta: number;      // 正=获得，负=支出
    note?: string;
}

/** 结算输出 */
export interface SettlementResult {
    bill: BillLine[];
    /** 状态变化：petId → 新状态 */
    statusUpdates: { petId: string; status: string; note: string }[];
    /** 心情变化：petId → 新心情 */
    moodUpdates: { petId: string; mood: number }[];
    resourcesAfter: Resources;
    /** 是否欠费跳闸 */
    tripped: boolean;
    /** 离线工单收益（结算前已单独计入 gold） */
    offlineIncome: number;
}

/** mulberry32 可播种 PRNG（与 Go 版对拍用同一算法） */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 每日维护结算：电费 → 饲料 → 工资 → 散热 → 心情 → 离线收益
 * 规则与方案文档 §2.6 表格一一对应。
 */
export function computeSettlement(input: SettlementInput, cfg: SettlementConfig): SettlementResult {
    const days = Math.max(1, input.daysElapsed);
    const rand = mulberry32(input.seed);
    const bill: BillLine[] = [];
    const statusUpdates: SettlementResult['statusUpdates'] = [];
    const moodUpdates: SettlementResult['moodUpdates'] = [];

    const res: Resources = { ...input.resources };
    const deployed = input.pets.filter(p => p.source === 'deploy');
    const rented = input.pets.filter(p => p.source === 'rent');

    // ---------- 0. 离线工单收益（封顶 maxOfflineDays） ----------
    const incomeDays = Math.min(days, cfg.maxOfflineDays);
    const offlineIncome = incomeDays * cfg.offlineGoldPerDay;
    res.gold += offlineIncome;
    bill.push({ item: '离线工单收益', delta: offlineIncome, note: `离线 ${days} 天，按 ${incomeDays} 天计` });

    // ---------- 1. 电费（功耗 × 天数 × 单价），不足 → 跳闸 ----------
    const powerUsed = deployed.length * cfg.powerPerDeployed + rented.length * cfg.powerPerRented;
    const powerCap = cfg.supply[input.facilities.power - 1] ?? cfg.supply[0];
    const electricBill = powerUsed * cfg.goldPerPowerUnit * days;
    let tripped = false;
    if (res.gold >= electricBill) {
        res.gold -= electricBill;
        bill.push({ item: '电费', delta: -electricBill, note: `功耗 ${powerUsed}W / 上限 ${powerCap}W × ${days} 天` });
    } else {
        tripped = true;
        bill.push({ item: '电费', delta: -res.gold, note: `金币不足，欠费跳闸！全站停摆 ${cfg.tripHaltHours} 小时` });
        res.gold = 0;
    }

    // ---------- 2. 饲料：小厨房产能 vs 部署AI娘消耗，不足 → 断粮变蔫 ----------
    const foodProduced = (cfg.foodPerDay[input.facilities.kitchen - 1] ?? cfg.foodPerDay[0]) * days;
    const foodNeeded = deployed.length * cfg.foodPerDeployed * days;
    res.food += foodProduced;
    bill.push({ item: '饲料产出', delta: foodProduced, note: `小厨房 × ${days} 天` });
    if (res.food >= foodNeeded) {
        res.food -= foodNeeded;
        bill.push({ item: '饲料消耗', delta: -foodNeeded, note: `${deployed.length} 只部署AI娘 × ${days} 天` });
    } else {
        res.food = 0;
        bill.push({ item: '饲料消耗', delta: -res.food, note: '断粮！全部部署AI娘变蔫' });
        for (const p of deployed) {
            if (p.status === 'normal') statusUpdates.push({ petId: p.id, status: 'hungry', note: '断粮，技能软绵绵' });
        }
    }

    // ---------- 3. 租用工资，不足 → 租用AI娘提前离场 ----------
    const wages = rented.length * cfg.wagePerRented * days;
    if (rented.length > 0) {
        if (res.token >= wages) {
            res.token -= wages;
            bill.push({ item: '租用工资', delta: -wages, note: `${rented.length} 只租用AI娘 × ${days} 天` });
        } else {
            bill.push({ item: '租用工资', delta: -res.token, note: 'Token不足，租用AI娘提前离场（触发告别事件）' });
            res.token = 0;
            for (const p of rented) {
                statusUpdates.push({ petId: p.id, status: 'rent_left', note: '工资没结清，含泪离开中转站' });
            }
        }
    }

    // ---------- 4. 散热：Σ热度 > 风扇容量 → 随机 1 只过热宕机 ----------
    const heat = deployed.length * cfg.heatPerDeployed + rented.length * cfg.heatPerRented;
    const coolCap = cfg.cooling[input.facilities.fan - 1] ?? cfg.cooling[0];
    if (heat > coolCap) {
        const candidates = input.pets.filter(p => p.status === 'normal');
        if (candidates.length > 0) {
            const victim = candidates[Math.floor(rand() * candidates.length)];
            statusUpdates.push({ petId: victim.id, status: 'overheat', note: `过热宕机（热度 ${heat} > 散热 ${coolCap}），拍机箱或用冰垫解` });
        }
        bill.push({ item: '散热检查', delta: 0, note: `过载：热度 ${heat} / 容量 ${coolCap}` });
    } else {
        bill.push({ item: '散热检查', delta: 0, note: `正常：热度 ${heat} / 容量 ${coolCap}` });
    }

    // ---------- 5. 心情：床位不足 → 心情衰减；低于阈值 → 情绪低落 ----------
    const beds = cfg.beds[input.facilities.dormitory - 1] ?? cfg.beds[0];
    if (deployed.length > beds) {
        for (const p of deployed) {
            const mood = Math.max(0, p.mood - cfg.moodDecayNoBed * days);
            moodUpdates.push({ petId: p.id, mood });
            if (mood < cfg.moodSadThreshold && p.status === 'normal') {
                statusUpdates.push({ petId: p.id, status: 'sad', note: '睡机架旁，心情掉到谷底' });
            }
        }
        bill.push({ item: '住宿检查', delta: 0, note: `床位不足：${deployed.length} 只 / ${beds} 床，心情衰减中` });
    } else {
        bill.push({ item: '住宿检查', delta: 0, note: `床位充足：${deployed.length} 只 / ${beds} 床` });
    }

    return { bill, statusUpdates, moodUpdates, resourcesAfter: res, tripped, offlineIncome };
}
