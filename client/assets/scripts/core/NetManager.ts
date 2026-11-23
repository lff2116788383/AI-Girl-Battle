import { WxAdapter } from './WxAdapter';

/**
 * NetManager —— 服务端 API 统一收口（方案文档 §4.3）
 *
 * 职责：
 *  - 登录（微信 wx-login / H5 开发直连）+ JWT token 管理
 *  - 云存档拉取/推送（乐观锁版本号）
 *  - 配置中心读取
 *
 * 设计约定：**服务端任何失败都不阻塞游戏启动** —— 置 online=false，
 * 业务层走本地模式（垫脚片配置 + 本地存档），静默降级。
 */

export class NetManager {

    private static token: string | null = null;
    private static _online = false;
    private static userId = 0;

    /** 云存档版本号（服务端乐观锁用） */
    public static cloudVersion = 0;
    /** 云端最新存档（登录后拉取，HomeModel 决定是否采用） */
    public static cloudSave: any = null;

    public static get online(): boolean { return NetManager._online; }
    public static get authToken(): string | null { return NetManager.token; }

    private static get base(): string {
        // ⚠️ 微信小游戏上线前替换为备案域名（小游戏后台需配置 request 合法域名）
        return WxAdapter.isWx ? 'https://api.your-domain.com' : 'http://127.0.0.1:8800';
    }

    private static readonly TOKEN_KEY = 'ai_relay_token';

    // ---------------- 登录 ----------------

    /**
     * 登录：微信走 code 换 JWT；H5 用测试 open_id。
     * 已有缓存 token 直接复用（过期由 401 触发重新登录）。
     * 永不 reject —— 失败置离线模式。
     */
    public static async login(): Promise<void> {
        NetManager.token = WxAdapter.storageGet(NetManager.TOKEN_KEY);
        if (NetManager.token) {
            NetManager._online = true; // 乐观认为有效，401 时再降级
            return;
        }
        try {
            const { code } = await WxAdapter.login();
            const isWx = WxAdapter.isWx;
            const resp = await WxAdapter.request(
                `${NetManager.base}/api/v1/auth/${isWx ? 'wx-login' : 'login'}`,
                'POST',
                isWx ? { code } : { open_id: code },
            );
            if (resp && resp.data && resp.data.token) {
                NetManager.token = resp.data.token;
                NetManager.userId = resp.data.user.id;
                WxAdapter.storageSet(NetManager.TOKEN_KEY, NetManager.token);
                NetManager._online = true;
                console.log(`[Net] 登录成功 userId=${NetManager.userId}`);
            } else {
                throw new Error('响应缺少 token');
            }
        } catch (e) {
            console.warn('[Net] 登录失败，进入本地模式:', e);
            NetManager._online = false;
        }
    }

    // ---------------- 通用带鉴权请求 ----------------

    private static async request(method: 'GET' | 'POST' | 'PUT', path: string, data?: any): Promise<any> {
        if (!NetManager.token) throw new Error('未登录');
        const resp = await WxAdapter.requestRaw(`${NetManager.base}${path}`, method, data, {
            'Authorization': `Bearer ${NetManager.token}`,
        });
        // 401 → token 失效，清缓存重新登录
        if (resp.status === 401) {
            NetManager.token = null;
            WxAdapter.storageRemove(NetManager.TOKEN_KEY);
            NetManager._online = false;
            throw new Error('token 已失效');
        }
        return resp.body;
    }

    // ---------------- 云存档 ----------------

    /** 拉取云端存档。返回是否有云端存档。 */
    public static async pullCloudSave(): Promise<boolean> {
        if (!NetManager._online) return false;
        try {
            const resp = await NetManager.request('GET', '/api/v1/user/state');
            if (resp && resp.data) {
                NetManager.cloudVersion = resp.data.version;
                try {
                    NetManager.cloudSave = JSON.parse(resp.data.state_json);
                } catch (e) {
                    console.warn('[Net] 云端存档解析失败', e);
                    return false;
                }
                return Object.keys(NetManager.cloudSave).length > 0;
            }
        } catch (e) {
            console.warn('[Net] 云存档拉取失败:', e);
        }
        return false;
    }

    /** 推送本地状态到云端（异步 fire-and-forget，带乐观锁版本号） */
    public static pushCloudSave(state: any): void {
        if (!NetManager._online) return;
        NetManager.request('PUT', '/api/v1/user/state', {
            state_json: JSON.stringify(state),
            version: NetManager.cloudVersion,
        }).then((resp) => {
            if (resp && resp.data) {
                NetManager.cloudVersion = resp.data.version;
            }
        }).catch((e) => {
            // 版本冲突（409）等：下次启动拉取时以云端为准
            console.warn('[Net] 云存档推送失败（将在下次启动时同步）:', e);
        });
    }

    // ---------------- 配置中心 ----------------

    public static async fetchConfig(): Promise<{ config_version: number; configs: any } | null> {
        try {
            const resp = await WxAdapter.requestRaw(`${NetManager.base}/api/v1/config/all`, 'GET', null, null);
            if (resp.status === 200 && resp.body && resp.body.configs) {
                return resp.body;
            }
        } catch (e) { /* 离线，由 ConfigManager 兜底 */ }
        return null;
    }

    // ---------------- PVE 战斗（W3） ----------------

    /** 关卡列表（服务端权威；离线由 ConfigManager 垫脚片兜底） */
    public static async battleLevels(): Promise<any[] | null> {
        try {
            const resp = await NetManager.request('GET', '/api/v1/battle/levels');
            if (resp && resp.data) return resp.data;
        } catch (e) {
            console.warn('[Net] 关卡列表拉取失败:', e);
        }
        return null;
    }

    /** 整场托管战斗：服务端 Go 引擎重放 → 权威结果+奖励+战报 */
    public static async battlePVE(payload: { levelId: string; seed: number; party: any[]; commands: any[][] }): Promise<any> {
        const resp = await NetManager.request('POST', '/api/v1/battle/pve', payload);
        if (!resp || !resp.data) throw new Error(resp && resp.error ? resp.error : '战斗响应异常');
        return resp.data;
    }

    /** 捕获结算（PVE 胜利后一次性掷骰锁定） */
    public static async capturePet(recordId: number): Promise<{ captured: boolean; speciesId: string }> {
        const resp = await NetManager.request('POST', `/api/v1/battle/capture/${recordId}`);
        if (!resp || !resp.data) throw new Error(resp && resp.error ? resp.error : '捕获响应异常');
        return resp.data;
    }

    // ---------------- 异步 PVP（W4） ----------------

    /** 上传/更新防守阵容（返回最新档案含积分） */
    public static async pvpSetDefense(payload: { party: any[]; mainName: string }): Promise<any> {
        const resp = await NetManager.request('POST', '/api/v1/battle/pvp/defense', payload);
        if (!resp || !resp.data) throw new Error(resp && resp.error ? resp.error : '防守阵容上传失败');
        return resp.data;
    }

    /** 发起挑战：匹配对手 → 服务端重放 → 积分结算（含对手阵容快照） */
    public static async pvpChallenge(payload: { seed: number; party: any[]; commands: any[][] }): Promise<any> {
        const resp = await NetManager.request('POST', '/api/v1/battle/pvp/challenge', payload);
        if (!resp || !resp.data) throw new Error(resp && resp.error ? resp.error : '挑战请求失败');
        return resp.data;
    }

    /** 排行榜前 50 */
    public static async pvpRanking(): Promise<any[]> {
        const resp = await NetManager.request('GET', '/api/v1/battle/pvp/ranking');
        if (!resp || !resp.data) throw new Error(resp && resp.error ? resp.error : '排行榜拉取失败');
        return resp.data;
    }
}
