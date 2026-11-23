/**
 * 可播种 PRNG（mulberry32）—— TS/Go 对拍的核心。
 *
 * 必须与 Go 端 server/internal/battle/prng.go 保持逐位一致：
 *   a += 0x6D2B79F5
 *   t = a ^ (a >> 15)
 *   t = t * (1 | a)        —— 32 位乘法（JS 用 Math.imul）
 *   t = (t + (t ^ (t >> 7)) * 61) ^ t
 *   返回 (t ^ (t >> 14)) 无符号值 / 2^32，区间 [0, 1)
 *
 * 禁止改动实现或消耗顺序，否则双端对拍全部失效。
 */

export class BattlePRNG {
    private a: number;

    constructor(seed: number) {
        this.a = seed >>> 0;
    }

    /** 返回 [0, 1) 浮点数 */
    next(): number {
        this.a = (this.a + 0x6d2b79f5) | 0;
        let t = this.a ^ (this.a >>> 15);
        t = Math.imul(t, 1 | this.a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}
