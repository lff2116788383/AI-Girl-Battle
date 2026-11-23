import { sys } from 'cc';

/**
 * WxAdapter —— 平台 API 统一收口（方案文档 §5.3）
 *
 * 一套工程双构建：
 *  - 微信小游戏：全部走 wx.* API
 *  - H5（开发期）：退化到浏览器/本地实现
 * 业务层禁止直接调用 wx.*，一律经过本类。
 */

// 微信全局对象声明（仅在微信小游戏运行时存在）
declare const wx: any;

export class WxAdapter {

    /** 当前是否运行在微信小游戏环境 */
    public static get isWx(): boolean {
        return typeof wx !== 'undefined' && !!wx.getSystemInfoSync;
    }

    /** 平台名（日志/调试用） */
    public static get platform(): string {
        return WxAdapter.isWx ? 'wechat-minigame' : `h5-${sys.platform}`;
    }

    // ---------------- 存储 ----------------

    public static storageSet(key: string, value: string): void {
        if (WxAdapter.isWx) {
            wx.setStorageSync(key, value);
        } else {
            try { localStorage.setItem(key, value); } catch (e) { console.error('[WxAdapter] localStorage 写入失败', e); }
        }
    }

    public static storageGet(key: string): string | null {
        if (WxAdapter.isWx) {
            try { return wx.getStorageSync(key) || null; } catch (e) { return null; }
        }
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    public static storageRemove(key: string): void {
        if (WxAdapter.isWx) {
            try { wx.removeStorageSync(key); } catch (e) { /* 忽略 */ }
        } else {
            try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
        }
    }

    // ---------------- 登录（W1 接入 code2session，MVP 本地模式返回测试身份） ----------------

    /**
     * 登录：微信环境走 wx.login 取 code（后端换 openid）；
     * H5 开发环境返回本地测试身份。
     * @returns code / 测试id
     */
    public static login(): Promise<{ code: string; isTest: boolean }> {
        return new Promise((resolve) => {
            if (WxAdapter.isWx) {
                wx.login({
                    success: (res: any) => resolve({ code: res.code || '', isTest: false }),
                    fail: () => resolve({ code: '', isTest: false }),
                });
            } else {
                resolve({ code: 'h5_test_user', isTest: true });
            }
        });
    }

    // ---------------- 网络请求（服务端接入后启用，MVP 家园系统本地运行不用） ----------------

    /**
     * 统一请求封装：微信走 wx.request，H5 走 XMLHttpRequest。
     * 注意：禁用 fetch（小游戏运行时无此全局对象）。
     */
    public static request(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', data?: any): Promise<any> {
        return WxAdapter.requestRaw(url, method, data, null).then(r => r.body);
    }

    /**
     * 底层请求：返回 { status, body }，供需要感知 HTTP 状态码的调用方使用。
     */
    public static requestRaw(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE',
        data?: any, headers?: { [k: string]: string } | null): Promise<{ status: number; body: any }> {
        if (WxAdapter.isWx) {
            return new Promise((resolve, reject) => {
                wx.request({
                    url, method, data,
                    header: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
                    success: (res: any) => {
                        let body = res.data;
                        if (typeof body === 'string') {
                            try { body = JSON.parse(body); } catch (e) { /* 保留原文 */ }
                        }
                        resolve({ status: res.statusCode, body });
                    },
                    fail: (err: any) => reject(err),
                });
            });
        }
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            if (headers) {
                for (const k of Object.keys(headers)) xhr.setRequestHeader(k, headers[k]);
            }
            xhr.onload = () => {
                let body: any = xhr.responseText;
                try { body = JSON.parse(xhr.responseText); } catch (e) { /* 保留原文 */ }
                resolve({ status: xhr.status, body });
            };
            xhr.onerror = () => reject(new Error(`请求失败: ${url}`));
            xhr.send(data ? JSON.stringify(data) : undefined);
        });
    }

    // ---------------- 分享（裂变入口，W4 启用） ----------------

    /** 主动分享战报卡片（仅微信环境生效） */
    public static shareReport(title: string, imageUrl?: string): void {
        if (!WxAdapter.isWx) { console.log('[WxAdapter] H5 环境跳过分享:', title); return; }
        wx.shareAppMessage({ title, imageUrl });
    }

    /** 被动分享：右上角菜单 + 场景内点击（拉新主入口） */
    public static initShare(title: string, imageUrl?: string): void {
        if (!WxAdapter.isWx) { console.log('[WxAdapter] H5 环境跳过被动分享初始化'); return; }
        wx.showShareMenu({ withShareTicket: false });
        wx.onShareAppMessage(() => ({ title, imageUrl }));
        wx.onShareTimeline(() => ({ title, imageUrl }));
    }

    // ---------------- 激励视频广告（W4：四件套之一） ----------------

    private static adInstances: { [id: string]: any } = {};

    /**
     * 播放激励视频广告。
     * 微信环境：wx.createRewardedVideoAd 单例复用，load → show；
     * H5 开发环境：模拟成功直接回调（上架前须配真实广告位）。
     */
    public static showRewardedAd(adUnitId: string, onReward: () => void, onFail?: (reason: string) => void): void {
        if (!WxAdapter.isWx) {
            console.log(`[WxAdapter] H5 模拟激励视频广告: ${adUnitId} → 直接发放奖励`);
            onReward();
            return;
        }
        try {
            let ad = WxAdapter.adInstances[adUnitId];
            if (!ad) {
                ad = wx.createRewardedVideoAd({ adUnitId });
                WxAdapter.adInstances[adUnitId] = ad;
            }
            const onClose = (res: any) => {
                ad.offClose(onClose);
                if (res && (res.isEnded || res.isEnded === undefined)) onReward();
                else if (onFail) onFail('广告中途关闭');
            };
            ad.onClose(onClose);
            ad.show().catch(() => {
                ad.load().then(() => ad.show()).catch((e: any) => {
                    ad.offClose(onClose);
                    if (onFail) onFail(`广告加载失败: ${e && e.errMsg ? e.errMsg : e}`);
                });
            });
        } catch (e: any) {
            if (onFail) onFail(`广告异常: ${e && e.message ? e.message : e}`);
        }
    }

    // ---------------- 订阅消息（W4：当日结算提醒，四件套之一） ----------------

    /** 请求订阅消息授权（模板 ID 由后台下发；H5 直接跳过） */
    public static subscribeMessage(tmplIds: string[], onDone?: (accepted: boolean) => void): void {
        if (!WxAdapter.isWx) { console.log('[WxAdapter] H5 环境跳过订阅消息:', tmplIds); if (onDone) onDone(false); return; }
        wx.requestSubscribeMessage({
            tmplIds,
            success: (res: any) => { if (onDone) onDone(res[tmplIds[0]] === 'accept'); },
            fail: () => { if (onDone) onDone(false); },
        });
    }
}
