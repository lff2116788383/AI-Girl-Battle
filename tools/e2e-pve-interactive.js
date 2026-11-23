/**
 * 交互式 PVE E2E：start → 逐回合提交指令（按快照 PP 选技能）→ 终局结算 → 校验
 * node e2e-pve-interactive.js [baseUrl=http://127.0.0.1:8800]
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

const party = [
    { uid: "p0", speciesId: "deepseek_niang", name: "DeepSeek娘", element: "network", stats: { compute: 62, bandwidth: 58, stability: 70, cooling: 85 }, skills: ["ws_keepalive", "cache_sweep", "stream_reply"] },
    { uid: "p1", speciesId: "deepseek_niang_2", name: "勤务班", element: "hardware", stats: { compute: 55, bandwidth: 52, stability: 74, cooling: 92 }, skills: ["log_rotate", "cool_blow", "ws_keepalive"] },
    { uid: "p2", speciesId: "deepseek_niang_3", name: "实习", element: "compute", stats: { compute: 48, bandwidth: 60, stability: 58, cooling: 70 }, skills: ["token_count", "ws_keepalive"] },
];

(async () => {
    // 1. 登录
    const login = await api("POST", "/api/v1/auth/login", { open_id: "e2e-interactive" });
    const token = login.data.token;
    console.log("✓ 登录:", login.data.user.nickname, "coins:", login.data.user.coins);

    // 2. 开局
    const before = (await api("GET", "/api/v1/user/profile", null, token)).data;
    const st = await api("POST", "/api/v1/battle/pve/interactive/start", {
        levelId: "lv01", seed: 777, party: party,
    }, token);
    const sessionId = st.data.sessionId;
    console.log(`✓ 会话创建: ${sessionId.slice(0, 8)}… 敌方: ${st.data.level.enemies.map(e => e.name).join("/")} maxTurns=${st.data.maxTurns}`);

    // 3. 越权校验：另一个用户提交该会话
    const other = (await api("POST", "/api/v1/auth/login", { open_id: "e2e-interactive-other" })).data;
    try {
        await api("POST", "/api/v1/battle/pve/interactive/command", { sessionId, command: { kind: "skill", index: 0 } }, other.token);
        console.log("✗ 越权提交未被拒绝！");
        process.exitCode = 1;
    } catch (e) { console.log("✓ 越权提交被正确拒绝"); }

    // 4. 逐回合提交：策略=当前在场宠第一个 PP>0 的技能（快照驱动，模拟真实客户端）
    let snap = null;
    let last = null;
    const t0 = Date.now();
    for (let guard = 0; guard < 60; guard++) {
        let cmd = null;
        if (snap) {
            const active = snap.pets.find(p => p.side === 0 && p.active);
            if (active) {
                const idx = active.pp.findIndex(v => v > 0);
                if (idx >= 0) cmd = { kind: "skill", index: idx };
            }
        } else {
            cmd = { kind: "skill", index: 0 };
        }
        last = await api("POST", "/api/v1/battle/pve/interactive/command", { sessionId, command: cmd }, token);
        snap = last.data.snapshot;
        if (guard < 3 || last.data.finished) {
            console.log(`  T${last.data.turn}: frames=${last.data.frames.length} ${last.data.finished ? `终局 winner=${last.data.winner}` : "进行中"} | 我方在场HP=${snap.pets.filter(p => p.side === 0 && p.active).map(p => p.hp).join("/")} 敌方=${snap.pets.filter(p => p.side === 1 && p.active).map(p => p.hp).join("/")}`);
        }
        if (last.data.finished) break;
    }

    // 5. 断言终局
    if (!last.data.finished) throw new Error("60 回合内未终局");
    const d = last.data;
    const after = d.user;
    console.log(`✓ 终局: winner=${d.winner}(${d.winner === 0 ? "胜" : "败"}) rewards=${JSON.stringify(d.rewards)} recordId=${d.recordId} 耗时${Math.round((Date.now() - t0) / 1000)}s`);
    console.log(`✓ 资源: coins ${before.coins} -> ${after.coins}`);

    // 6. 终局后旧会话已销毁
    try {
        await api("POST", "/api/v1/battle/pve/interactive/command", { sessionId, command: { kind: "skill", index: 0 } }, token);
        console.log("✗ 终局后旧会话未被销毁！");
        process.exitCode = 1;
    } catch (e) { console.log("✓ 终局后旧会话已正确销毁"); }

    // 7. 战报回查
    const rec = await api("GET", `/api/v1/battle/record/${d.recordId}`, null, token);
    console.log(`✓ 战报回查: level=${rec.data.level_id} result=${rec.data.result} turns=${rec.data.turn_count}`);

    // 8. abandon 流程
    const st2 = await api("POST", "/api/v1/battle/pve/interactive/start", { levelId: "lv02", seed: 1, party: party }, token);
    const ab = await api("POST", "/api/v1/battle/pve/interactive/abandon", { sessionId: st2.data.sessionId }, token);
    console.log("✓ abandon:", ab.message);
    try {
        await api("POST", "/api/v1/battle/pve/interactive/command", { sessionId: st2.data.sessionId, command: null }, token);
        console.log("✗ abandon 后提交未被拒绝！");
        process.exitCode = 1;
    } catch (e) { console.log("✓ abandon 后提交被正确拒绝"); }

    console.log("\n=== 交互式 PVE E2E 全部通过 ===");
})().catch(e => { console.error("E2E 失败:", e.message); process.exit(1); });
