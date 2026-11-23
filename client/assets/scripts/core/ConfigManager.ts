import { JsonAsset, resources } from 'cc';
import { WxAdapter } from './WxAdapter';
import { NetManager } from './NetManager';

/**
 * ConfigManager —— 配置中心客户端（方案文档 §4.6 服务端权威数值）
 *
 * 三级来源（按优先级）：
 *  1. 服务端 /config/all（configVersion 比对后拉取，运营改数值无需发版）
 *  2. 本地缓存（上次拉取成功的结果，storage）
 *  3. 垫脚片（resources/config/*.json，开发期兜底，服务端落地后仅作最后防线）
 */
export class ConfigManager {

    private static configs: { [key: string]: any } | null = null;
    private static _configVersion = 0;
    private static _source: 'server' | 'cache' | 'fallback' | 'none' = 'none';

    public static get configVersion(): number { return ConfigManager._configVersion; }
    public static get source(): string { return ConfigManager._source; }

    private static readonly CACHE_KEY = 'ai_relay_config_cache';

    /** 初始化：按三级来源加载配置。永不 reject（最坏垫脚片兜底）。 */
    public static async load(): Promise<void> {
        // 1. 服务端
        const remote = await NetManager.fetchConfig();
        if (remote) {
            ConfigManager.apply(remote.configs, remote.config_version, 'server');
            WxAdapter.storageSet(ConfigManager.CACHE_KEY, JSON.stringify(remote));
            return;
        }

        // 2. 本地缓存
        const cached = WxAdapter.storageGet(ConfigManager.CACHE_KEY);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.configs) {
                    ConfigManager.apply(parsed.configs, parsed.config_version, 'cache');
                    return;
                }
            } catch (e) { /* 缓存损坏，走垫脚片 */ }
        }

        // 3. 垫脚片
        try {
            const [fac, pets, set, levels, battleRules] = await Promise.all([
                ConfigManager.loadJson('config/facilities'),
                ConfigManager.loadJson('config/pets'),
                ConfigManager.loadJson('config/settlement'),
                ConfigManager.loadJson('config/levels').catch(() => null),
                ConfigManager.loadJson('config/battle-rules').catch(() => null),
            ]);
            ConfigManager.apply({
                facilities: fac.json, pets: pets.json, settlement: set.json,
                levels: levels ? levels.json : null,
                'battle-rules': battleRules ? battleRules.json : null,
            }, 0, 'fallback');
        } catch (e) {
            console.error('[Config] 垫脚片也加载失败，家园系统不可用:', e);
        }
    }

    /** 取一个配置包（如 'facilities' / 'pets' / 'settlement'） */
    public static get(key: string): any | null {
        return ConfigManager.configs ? ConfigManager.configs[key] ?? null : null;
    }

    private static apply(configs: any, version: number, source: 'server' | 'cache' | 'fallback'): void {
        ConfigManager.configs = configs;
        ConfigManager._configVersion = version;
        ConfigManager._source = source;
        console.log(`[Config] 配置加载完成 source=${source} configVersion=${version}`);
    }

    private static loadJson(path: string): Promise<JsonAsset> {
        return new Promise((resolve, reject) => {
            resources.load(path, JsonAsset, (err, asset) => {
                if (err) { reject(err); return; }
                resolve(asset);
            });
        });
    }
}
