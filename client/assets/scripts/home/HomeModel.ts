import { SaveManager } from '../core/SaveManager';
import { ConfigManager } from '../core/ConfigManager';
import { NetManager } from '../core/NetManager';
import { PetData, PetStatus, SpeciesDef, PetSource, makePet } from '../pet/PetData';
import { FacilityLevels, Resources, SettlementConfig, SettlementInput, SettlementResult, computeSettlement } from './SettlementEngine';

/**
 * HomeModel —— 家园系统运行时状态（方案文档 §2.1 / §2.6）
 * MVP 本地权威；服务端接入后，结算以服务器结果为准，本类退化为预测/展示。
 */

export interface FacilityDef {
    key: keyof FacilityLevels;
    name: string;
    desc: string;
    levels: { lv: number; upgradeCost: { gold: number } }[];
}

export interface HomeSaveData {
    facilities: FacilityLevels;
    pets: PetData[];
    resources: Resources;
    lastSettledAt: number;
    trippedUntil: number;   // 跳闸截止时间戳（0 = 未跳闸）
}

export class HomeModel {

    public facilities: FacilityLevels = { dormitory: 1, power: 1, fan: 1, kitchen: 1 };
    public pets: PetData[] = [];
    public resources: Resources = { gold: 0, token: 0, food: 0, parts: 0, coolPads: 0 };
    public lastSettledAt: number = Date.now();
    public trippedUntil: number = 0;

    public facilityDefs: { [key: string]: FacilityDef } = {};
    public species: { [key: string]: SpeciesDef } = {};
    public upkeep: any = {};
    public settlementCfg: SettlementConfig | null = null;

    private static _instance: HomeModel = null;

    public static get instance(): HomeModel {
        if (!HomeModel._instance) HomeModel._instance = new HomeModel();
        return HomeModel._instance;
    }

    /**
     * 启动流程（方案文档 §4.6/§4.7 落地）：
     * 1. 服务端登录（失败静默降级为本地模式）
     * 2. ConfigManager 三级配置（服务端权威 → 本地缓存 → 垫脚片）
     * 3. 存档来源：云端优先 → 本地 → 首跑初始化
     */
    public async init(): Promise<void> {
        // 1. 登录 + 2. 配置
        await NetManager.login();
        await ConfigManager.load();

        const fac = ConfigManager.get('facilities');
        const petCfg = ConfigManager.get('pets');
        const setCfg = ConfigManager.get('settlement');
        if (!fac || !petCfg || !setCfg) {
            console.error('[HomeModel] 配置缺失，家园系统无法初始化');
            return;
        }

        // 设施定义
        const facKeys: (keyof FacilityLevels)[] = ['dormitory', 'power', 'fan', 'kitchen'];
        for (const key of facKeys) {
            const d = fac[key];
            this.facilityDefs[key] = { key, name: d.name, desc: d.desc, levels: d.levels };
        }
        // 种族表
        this.species = petCfg.species;
        this.upkeep = petCfg.upkeep;
        // 结算配置合成（设施容量 + 养护常数 → SettlementConfig）
        const s = setCfg.settlement;
        this.settlementCfg = {
            beds: fac.dormitory.levels.map((l: any) => l.beds),
            supply: fac.power.levels.map((l: any) => l.supply),
            cooling: fac.fan.levels.map((l: any) => l.cooling),
            foodPerDay: fac.kitchen.levels.map((l: any) => l.foodPerDay),
            powerPerDeployed: this.upkeep.powerPerDeployed,
            powerPerRented: this.upkeep.powerPerRented,
            heatPerDeployed: this.upkeep.heatPerDeployed,
            heatPerRented: this.upkeep.heatPerRented,
            foodPerDeployed: this.upkeep.foodPerDeployed,
            wagePerRented: this.upkeep.wagePerRented,
            goldPerPowerUnit: this.upkeep.goldPerPowerUnit,
            maxOfflineDays: s.maxOfflineDays,
            offlineGoldPerDay: s.offlineGoldPerDay,
            tripHaltHours: s.tripHaltHours,
            moodDecayNoBed: s.moodDecayNoBed,
            moodSadThreshold: s.moodSadThreshold,
        };

        // 3. 存档来源决策
        const hasCloud = await NetManager.pullCloudSave();
        const local = SaveManager.load<HomeSaveData>();

        if (hasCloud && NetManager.cloudSave) {
            // 云端优先（跨端续玩的正确语义）；本地较新时以本地为准并回推
            const cloud = NetManager.cloudSave as HomeSaveData;
            if (local && local.lastSettledAt > (cloud.lastSettledAt || 0)) {
                console.log('[HomeModel] 本地存档较新，采用本地并回推云端');
            } else {
                this.applySave(cloud);
            }
        } else if (local) {
            this.applySave(local);
        } else {
            this.initFirstRun();
        }
    }

    private applySave(saved: HomeSaveData): void {
        this.facilities = saved.facilities;
        this.pets = saved.pets;
        this.resources = saved.resources;
        this.lastSettledAt = saved.lastSettledAt;
        this.trippedUntil = saved.trippedUntil || 0;
    }

    /** 首次运行：MVP 阵容 —— 3 部署 + 1 租用（方案文档 §1.2） */
    private initFirstRun(): void {
        const setJson = { gold: 1000, token: 50, food: 60, parts: 0, coolPads: 1 };
        this.resources = { ...setJson };
        const lineup: [string, string, PetSource, number][] = [
            ['deepseek_niang', '小深', 'deploy', 0],
            ['deepseek_niang_2', '小蓝', 'deploy', 0],
            ['deepseek_niang_3', '鲸尾', 'deploy', 0],
            ['rental_whale', '租用·鲸鲸', 'rent', 7],
        ];
        this.pets = lineup.map(([sid, name, src, days]) => makePet(this.species[sid], name, src, days));
        this.persist();
    }

    /** 本地落盘 + 云端异步推送（离线时自动只写本地） */
    public persist(): void {
        const state: HomeSaveData = {
            facilities: this.facilities,
            pets: this.pets,
            resources: this.resources,
            lastSettledAt: this.lastSettledAt,
            trippedUntil: this.trippedUntil,
        };
        SaveManager.save<HomeSaveData>(state);
        NetManager.pushCloudSave(state);
    }

    // ---------------- 负载快照（UI 展示） ----------------

    public powerUsed(): number {
        return this.pets
            .filter(p => p.status !== 'rent_left')
            .reduce((sum, p) => sum + (p.source === 'deploy' ? this.upkeep.powerPerDeployed : this.upkeep.powerPerRented), 0);
    }

    public powerCap(): number {
        return this.facilityDefs.power.levels[this.facilities.power - 1]?.['supply'] ?? 0;
    }

    public heatUsed(): number {
        return this.pets
            .filter(p => p.status !== 'rent_left')
            .reduce((sum, p) => sum + (p.source === 'deploy' ? this.upkeep.heatPerDeployed : this.upkeep.heatPerRented), 0);
    }

    public coolingCap(): number {
        return this.facilityDefs.fan.levels[this.facilities.fan - 1]?.['cooling'] ?? 0;
    }

    public deployedCount(): number {
        return this.pets.filter(p => p.source === 'deploy' && p.status !== 'rent_left').length;
    }

    public beds(): number {
        return this.facilityDefs.dormitory.levels[this.facilities.dormitory - 1]?.['beds'] ?? 0;
    }

    // ---------------- 设施升级 ----------------

    public upgradeFacility(key: keyof FacilityLevels): { ok: boolean; msg: string } {
        const def = this.facilityDefs[key];
        const curLv = this.facilities[key];
        const next = def.levels.find(l => l.lv === curLv + 1);
        if (!next) return { ok: false, msg: `${def.name}已是满级` };
        if (this.resources.gold < next.upgradeCost.gold) {
            return { ok: false, msg: `金币不足（需 ${next.upgradeCost.gold}，现有 ${this.resources.gold}）` };
        }
        this.resources.gold -= next.upgradeCost.gold;
        this.facilities[key] = curLv + 1;
        this.persist();
        return { ok: true, msg: `${def.name} 升到 Lv.${curLv + 1}！` };
    }

    // ---------------- 每日结算 ----------------

    /** 距上次结算的天数（按 86400 秒折算，测试可手动拨快） */
    public daysElapsed(): number {
        const days = Math.floor((Date.now() - this.lastSettledAt) / 86400_000);
        return Math.max(days, 0);
    }

    /** 结算预览：不落盘，纯展示 */
    public previewSettlement(): SettlementResult {
        const input: SettlementInput = {
            facilities: this.facilities,
            pets: this.pets.filter(p => p.status !== 'rent_left').map(p => ({
                id: p.id, name: p.name, source: p.source, status: p.status, mood: p.mood,
            })),
            resources: { ...this.resources },
            daysElapsed: Math.max(this.daysElapsed(), 1),
            seed: Date.now() % 2147483647,
        };
        return computeSettlement(input, this.settlementCfg);
    }

    /** 执行结算：应用结果并落盘 */
    public runSettlement(): SettlementResult {
        const result = this.previewSettlement();
        this.resources = result.resourcesAfter;
        for (const u of result.statusUpdates) {
            const pet = this.pets.find(p => p.id === u.petId);
            if (pet) {
                if (u.status === 'rent_left') {
                    pet.status = 'normal';
                    pet.name = pet.name; // 租用离场：保留记录但标记
                    pet.rentExpireAt = 0;
                    (pet as any).left = true;
                } else {
                    pet.status = u.status as PetStatus;
                }
            }
        }
        for (const m of result.moodUpdates) {
            const pet = this.pets.find(p => p.id === m.petId);
            if (pet) pet.mood = m.mood;
        }
        if (result.tripped) {
            this.trippedUntil = Date.now() + this.settlementCfg.tripHaltHours * 3600_000;
        }
        this.lastSettledAt = Date.now();
        this.persist();
        return result;
    }

    /** 冰垫解救过热AI娘 */
    public rescueOverheat(petId: string): { ok: boolean; msg: string } {
        const pet = this.pets.find(p => p.id === petId);
        if (!pet || pet.status !== 'overheat') return { ok: false, msg: '该AI娘没有宕机' };
        if (this.resources.coolPads <= 0) return { ok: false, msg: '没有冰垫了（商店购买/MVP暂发1个）' };
        this.resources.coolPads -= 1;
        pet.status = 'normal';
        this.persist();
        return { ok: true, msg: `${pet.name} 被冰垫救回来了！` };
    }

    /** 测试用：拨快时间（跳过离线等待） */
    public debugAdvanceDays(days: number): void {
        this.lastSettledAt -= days * 86400_000;
        this.persist();
    }
}
