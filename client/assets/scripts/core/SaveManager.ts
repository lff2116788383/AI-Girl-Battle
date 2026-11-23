import { WxAdapter } from './WxAdapter';

/**
 * SaveManager —— 本地存档（云存档接入前的落地层）
 * 微信：wx.setStorageSync；H5：localStorage
 * 存档结构带版本号，便于后续迁移。
 */
export class SaveManager {

    private static readonly KEY = 'ai_relay_save_v1';

    public static load<T>(): T | null {
        const raw = WxAdapter.storageGet(SaveManager.KEY);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed.version !== 1) {
                console.warn('[SaveManager] 存档版本不匹配，忽略:', parsed.version);
                return null;
            }
            return parsed.data as T;
        } catch (e) {
            console.error('[SaveManager] 存档解析失败', e);
            return null;
        }
    }

    public static save<T>(data: T): void {
        const payload = JSON.stringify({ version: 1, savedAt: Date.now(), data });
        WxAdapter.storageSet(SaveManager.KEY, payload);
    }

    public static clear(): void {
        WxAdapter.storageRemove(SaveManager.KEY);
    }
}
