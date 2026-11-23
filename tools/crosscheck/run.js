/**
 * TS/Go 战斗引擎对拍 runner —— node run.js
 * 流程：esbuild bundle TS 引擎 → node 跑 fixtures → go run 跑同一份 fixtures → 逐 case 深比较帧列表。
 * 任一 case 不一致即退出码 1，并打印第一处差异。
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const TMP = path.join(__dirname, ".tmp");
const FIXTURES = path.resolve(process.argv[2] || path.join(__dirname, "fixtures.json"));
const RULES = path.join(ROOT, "shared", "rules", "battle-rules.json");

function sh(cmd, opts) {
    console.log("$", cmd);
    execSync(cmd, { stdio: "inherit", ...(opts || {}) });
}

function deepEqual(a, b, where) {
    if (a === b) return null;
    if (typeof a === "number" && typeof b === "number") {
        if (Object.is(a, b)) return null;
        return `${where}: number diff ${a} vs ${b}`;
    }
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
        return `${where}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
    }
    const ak = Array.isArray(a);
    const bk = Array.isArray(b);
    if (ak !== bk) return `${where}: array vs object`;
    if (ak) {
        if (a.length !== b.length) return `${where}: len ${a.length} vs ${b.length}`;
        for (let i = 0; i < a.length; i++) {
            const r = deepEqual(a[i], b[i], `${where}[${i}]`);
            if (r) return r;
        }
        return null;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        const r = deepEqual(a[k], b[k], `${where}.${k}`);
        if (r) return r;
    }
    return null;
}

async function main() {
    fs.mkdirSync(TMP, { recursive: true });

    // 1. bundle TS 引擎
    const esbuild = path.join(__dirname, "node_modules", ".bin", "esbuild");
    sh(`"${esbuild}" replay-entry.ts --bundle --platform=node --outfile="${path.join(TMP, "replay-ts.cjs")}" --log-level=warning`, { cwd: __dirname });

    // 2. 双端跑 fixtures
    sh(`node "${path.join(TMP, "replay-ts.cjs")}" "${FIXTURES}" "${RULES}" > "${path.join(TMP, "frames-ts.json")}"`);
    const goOut = path.join(TMP, "frames-go.json");
    sh(`go run ./cmd/battlereplay "${FIXTURES}" "${RULES}" > "${goOut}"`, { cwd: path.join(ROOT, "server") });

    // 3. 深比较
    const ts = JSON.parse(fs.readFileSync(path.join(TMP, "frames-ts.json"), "utf8"));
    const go = JSON.parse(fs.readFileSync(goOut, "utf8"));
    let pass = 0, fail = 0;
    for (let i = 0; i < Math.max(ts.results.length, go.results.length); i++) {
        const t = ts.results[i], g = go.results[i];
        const label = (t && t.name) || (g && g.name) || `#${i}`;
        if (!t || !g) { console.log(`✗ ${label}: 缺少一侧结果`); fail++; continue; }
        const diff = deepEqual(t, g, label);
        if (diff) { console.log(`✗ ${label}: ${diff}`); fail++; }
        else { console.log(`✓ ${label}: winner=${t.winner} turns=${t.turns} frames=${t.frames.length} 一致`); pass++; }
    }
    console.log(`\n对拍结果: ${pass} 通过 / ${fail} 失败`);
    if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
