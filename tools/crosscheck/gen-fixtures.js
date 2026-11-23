/**
 * 对拍 fixtures 生成器（确定性，无随机）—— node gen-fixtures.js [输出路径]
 * 覆盖路径：普攻 / 先手技能 / 换宠 / PP 耗尽 skip / faint 换人 / buff/shield/heal /
 * 带宽平局 tie-break（case-05 对称阵容）/ maxTurns 超时判 HP。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "rules", "battle-rules.json"), "utf8"));

// 种族数据（与 client pets.json 对应，element 转引擎英文 key）
const SPECIES = {
    deepseek_niang:    { name: "DeepSeek娘",        element: "network",  stats: { compute: 62, bandwidth: 58, stability: 70, cooling: 85 } },
    deepseek_niang_2:  { name: "DeepSeek娘·勤务班", element: "hardware", stats: { compute: 55, bandwidth: 52, stability: 74, cooling: 92 } },
    deepseek_niang_3:  { name: "DeepSeek娘·实习",   element: "compute",  stats: { compute: 48, bandwidth: 60, stability: 58, cooling: 70 } },
    rental_whale:      { name: "租用·鲸鲸",         element: "anomaly",  stats: { compute: 50, bandwidth: 55, stability: 60, cooling: 65 } },
};

function pet(side, idx, speciesId, skills) {
    const s = SPECIES[speciesId];
    return {
        uid: `s${side}p${idx}_${speciesId}`,
        speciesId: speciesId,
        name: `${s.name}(${side}${idx})`,
        element: s.element,
        stats: { ...s.stats },
        skills: skills,
    };
}

// 常用阵容
const partyStd = (side) => [
    pet(side, 0, "deepseek_niang", ["ws_keepalive", "cache_sweep", "stream_reply"]),
    pet(side, 1, "deepseek_niang_2", ["log_rotate", "cool_blow", "ws_keepalive"]),
    pet(side, 2, "deepseek_niang_3", ["token_count", "ws_keepalive"]),
];
const partyBuff = (side) => [
    pet(side, 0, "deepseek_niang", ["overclock", "checkpoint_restore", "stream_reply"]),
    pet(side, 1, "deepseek_niang_2", ["cool_blow", "log_rotate"]),
    pet(side, 2, "rental_whale", ["err_inject", "null_deref"]),
];
// case-05 对称阵容：带宽完全相等 → 每回合 tie-break PRNG
const partyMirror = (side) => [
    pet(side, 0, "deepseek_niang", ["ws_keepalive", "gpu_burst", "overclock"]),
    pet(side, 1, "deepseek_niang", ["cache_sweep", "stream_reply"]),
    pet(side, 2, "deepseek_niang_2", ["log_rotate"]),
];

/** 确定性指令策略 */
function cmd(skillOffset, switchEvery) {
    return (turn, side, partySize) => {
        if (switchEvery > 0 && turn % switchEvery === 0 && turn > 1) {
            const slot = ((turn / switchEvery) | 0) % partySize;
            if (slot !== 0) return { kind: "switch", index: slot };
        }
        return { kind: "skill", index: (turn * 2 + side + skillOffset) % 3 };
    };
}

const cases = [
    { name: "case-01-basic",        seed: 42,      a: partyStd(0),  b: partyStd(1),  cmdA: cmd(0, 0),  cmdB: cmd(1, 0) },
    { name: "case-02-switch-heavy", seed: 12345,   a: partyStd(0),  b: partyBuff(1), cmdA: cmd(0, 7),  cmdB: cmd(2, 5) },
    { name: "case-03-pp-exhaust",   seed: 777,     a: partyStd(0),  b: partyStd(1),  cmdA: cmd(0, 0),  cmdB: cmd(0, 0) },
    { name: "case-04-buff-shield",  seed: 9999999, a: partyBuff(0), b: partyBuff(1), cmdA: cmd(0, 9),  cmdB: cmd(1, 11) },
    { name: "case-05-mirror-tie",   seed: 1,       a: partyMirror(0), b: partyMirror(1), cmdA: cmd(0, 0), cmdB: cmd(0, 0) },
    { name: "case-06-long-war",     seed: 20261123, a: partyStd(0), b: partyBuff(1), cmdA: cmd(1, 13), cmdB: cmd(0, 3) },
];

const fixtures = {
    comment: "TS/Go 对拍用例 —— 由 tools/crosscheck/gen-fixtures.js 生成，勿手改",
    cases: cases.map(c => {
        const maxTurn = rules.turn.maxTurns;
        const commands = [];
        for (let turn = 1; turn <= maxTurn; turn++) {
            commands.push([
                c.cmdA(turn, 0, c.a.length),
                c.cmdB(turn, 1, c.b.length),
            ]);
        }
        return {
            name: c.name,
            seed: c.seed,
            sideA: c.a,
            sideB: c.b,
            commands: commands,
        };
    }),
};

const out = process.argv[2] || path.join(__dirname, "fixtures.json");
fs.writeFileSync(out, JSON.stringify(fixtures, null, 2));
console.log("fixtures written:", out, "cases:", fixtures.cases.length);
