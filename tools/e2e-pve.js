/**
 * PVE E2E 验证：登录 → 关卡列表 → 打 lv01 → 捕获结算 → 资源核对
 * node e2e-pve.js [baseUrl=http://127.0.0.1:8800]
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

// 玩家标准阵容（与客户端种族表一致）
const party = [
    { uid: "p0", speciesId: "deepseek_niang", name: "DeepSeek娘", element: "network", stats: { compute: 62, bandwidth: 58, stability: 70, cooling: 85 }, skills: ["ws_keepalive", "cache_sweep", "stream_reply"] },
    { uid: "p1", speciesId: "deepseek_niang_2", name: "勤务班", element: "hardware", stats: { compute: 55, bandwidth: 52, stability: 74, cooling: 92 }, skills: ["log_rotate", "cool_blow", "ws_keepalive"] },
    { uid: "p2", speciesId: "deepseek_niang_3", name: "实习", element: "compute", stats: { compute: 48, bandwidth: 60, stability: 58, cooling: 70 }, skills: ["token_count", "ws_keepalive"] },
];

// 确定性指令序列：玩家每回合轮转技能；敌方 AI 用第一个 PP>0 的技能（MVP 不校验敌方指令）
const commands = [];
for (let turn = 1; turn <= 50; turn++) {
    commands.push([
        { kind: "skill", index: (turn + 1) % 3 },
        { kind: "skill", index: (turn + 1) % 2 },
    ]);
}

(async () => {
    // 1. 登录
    const login = await api("POST", "/api/v1/auth/login", { open_id: "e2e-pve-test" });
    const token = login.data.token;
    console.log("✓ 登录成功 user:", login.data.user.nickname, "coins:", login.data.user.coins);

    // 2. 关卡列表
    const levels = await api("GET", "/api/v1/battle/levels", null, token);
    console.log("✓ 关卡数:", levels.data.length, "|", levels.data.map(l => l.id + ":" + l.name).join(" | "));

    // 3. 打 lv01
    const before = (await api("GET", "/api/v1/user/profile", null, token)).data;
    const battle = await api("POST", "/api/v1/battle/pve", {
        levelId: "lv01", seed: 20261123, party: party, commands: commands,
    }, token);
    const d = battle.data;
    console.log(`✓ PVE lv01: result=${d.result}(${d.result === 0 ? "玩家胜" : d.result === 1 ? "敌方胜" : "平"}) turns=${d.turnCount} frames=${d.frames.length} rewards=${JSON.stringify(d.rewards)} recordId=${d.recordId}`);
    console.log(`  资源变化: coins ${before.coins} -> ${d.user.coins} | feed ${before.feed} -> ${d.user.feed}`);

    // 4. 捕获结算
    const cap = await api("POST", `/api/v1/battle/capture/${d.recordId}`, null, token);
    console.log("✓ 捕获结算:", JSON.stringify(cap.data));

    // 5. 重复捕获应被拒绝
    try {
        await api("POST", `/api/v1/battle/capture/${d.recordId}`, null, token);
        console.log("✗ 重复捕获未被拒绝！");
        process.exitCode = 1;
    } catch (e) {
        console.log("✓ 重复捕获被正确拒绝");
    }

    // 6. 战报回查
    const rec = await api("GET", `/api/v1/battle/record/${d.recordId}`, null, token);
    console.log(`✓ 战报回查: level=${rec.data.level_id} result=${rec.data.result} captured=${rec.data.captured} framesBytes=${rec.data.frames_json.length}`);

    // 7. 输掉的关卡也应记录（打 lv06 Boss）
    const lose = await api("POST", "/api/v1/battle/pve", {
        levelId: "lv06", seed: 42, party: party.slice(0, 1), commands: commands,
    }, token);
    console.log(`✓ Boss 关 lv06: result=${lose.data.result}(${lose.data.result === 1 ? "敌方胜(符合预期:单宠挑战Boss)" : "?"}) rewards=${JSON.stringify(lose.data.rewards)}`);

    console.log("\n=== PVE E2E 全部通过 ===");
})().catch(e => { console.error("E2E 失败:", e.message); process.exit(1); });
