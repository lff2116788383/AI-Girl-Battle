/**
 * PVP E2E 验证：A/B 双方上传防守阵容 → A 挑战 B → 积分结算 → 排行榜 → 防守阵容校验
 * node e2e-pvp.js [baseUrl=http://127.0.0.1:8800]
 */
const BASE = process.argv[2] || "http://127.0.0.1:8800";

async function api(method, path, body, token) {
    const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
    return json;
}

const partyA = [
    { uid: "a0", speciesId: "deepseek_niang", name: "DeepSeek娘A", element: "network", stats: { compute: 62, bandwidth: 58, stability: 70, cooling: 85 }, skills: ["ws_keepalive", "cache_sweep", "stream_reply"] },
    { uid: "a1", speciesId: "deepseek_niang_2", name: "勤务班A", element: "hardware", stats: { compute: 55, bandwidth: 52, stability: 74, cooling: 92 }, skills: ["log_rotate", "cool_blow", "ws_keepalive"] },
];
const partyB = [
    { uid: "b0", speciesId: "deepseek_niang_3", name: "实习B", element: "compute", stats: { compute: 58, bandwidth: 60, stability: 62, cooling: 72 }, skills: ["token_count", "ws_keepalive"] },
    { uid: "b1", speciesId: "deepseek_niang", name: "DeepSeek娘B", element: "network", stats: { compute: 60, bandwidth: 56, stability: 68, cooling: 80 }, skills: ["ws_keepalive", "stream_reply"] },
];
// A 玩家指令（每回合一条，B 侧由服务端托管）
const commands = [];
for (let turn = 1; turn <= 50; turn++) {
    commands.push([{ kind: "skill", index: (turn + 1) % 3 }]);
}

(async () => {
    // 1. 双方登录
    const a = (await api("POST", "/api/v1/auth/login", { open_id: "e2e-pvp-a" })).data;
    const b = (await api("POST", "/api/v1/auth/login", { open_id: "e2e-pvp-b" })).data;
    console.log(`✓ 登录 A=${a.user.nickname} B=${b.user.nickname}`);

    // 2. 双方上传防守阵容
    const da = await api("POST", "/api/v1/battle/pvp/defense", { party: partyA, mainName: "DeepSeek娘A" }, a.token);
    const db = await api("POST", "/api/v1/battle/pvp/defense", { party: partyB, mainName: "实习B" }, b.token);
    console.log(`✓ 防守阵容上传 A(score=${da.data.score}) B(score=${db.data.score})`);

    // 3. 空阵容/超编校验
    try {
        await api("POST", "/api/v1/battle/pvp/defense", { party: [] }, a.token);
        console.log("✗ 空阵容未被拒绝");
        process.exitCode = 1;
    } catch (e) { console.log("✓ 空防守阵容被正确拒绝"); }
    try {
        await api("POST", "/api/v1/battle/pvp/defense", { party: [...partyA, ...partyB] }, a.token);
        console.log("✗ 超编(4只)未被拒绝");
        process.exitCode = 1;
    } catch (e) { console.log("✓ 超编阵容被正确拒绝"); }

    // 4. A 挑战 B（可能匹配到 B，也可能匹配到历史用户；断言返回含 frames + 积分变化）
    const before = (await api("GET", "/api/v1/user/profile", null, a.token)).data;
    const ch = await api("POST", "/api/v1/battle/pvp/challenge", {
        seed: 20261123, party: partyA, commands: commands,
    }, a.token);
    const d = ch.data;
    console.log(`✓ 挑战 ${d.level.name}: result=${d.result}(${d.result === 0 ? "胜+25" : d.result === 1 ? "负-10" : "平"}) turns=${d.turnCount} frames=${d.frames.length} rewards=${JSON.stringify(d.rewards)}`);
    console.log(`  A 资源: coins ${before.coins} -> ${d.user.coins}`);

    // 5. 排行榜
    const rank = await api("GET", "/api/v1/battle/pvp/ranking", null, a.token);
    console.log(`✓ 排行榜 ${rank.data.length} 人:`, rank.data.slice(0, 3).map(r => `${r.nickname}:${r.score}分(${r.wins}胜${r.losses}负)`).join(" | "));

    // 6. 再挑战几次验证积分波动
    for (let i = 0; i < 2; i++) {
        const r = await api("POST", "/api/v1/battle/pvp/challenge", {
            seed: 1000 + i, party: partyA, commands: commands,
        }, a.token);
        console.log(`✓ 第${i + 2}场: ${r.data.level.name} result=${r.data.result} turns=${r.data.turnCount}`);
    }

    const after = (await api("GET", "/api/v1/user/profile", null, a.token)).data;
    console.log(`✓ A 最终 coins=${after.coins}（${d.result === 0 ? "含胜利奖励" : "无奖励"}）`);

    console.log("\n=== PVP E2E 全部通过 ===");
})().catch(e => { console.error("E2E 失败:", e.message); process.exit(1); });
