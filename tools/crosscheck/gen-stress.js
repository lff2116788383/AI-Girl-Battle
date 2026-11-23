/**
 * 压力对拍 fixtures 生成器 —— 随机种子/阵容/技能/指令，每次运行产出不同用例。
 * node gen-stress.js [场数=200] [输出路径]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "rules", "battle-rules.json"), "utf8"));
const SKILL_IDS = Object.keys(rules.skills);
const SPECIES = [
    { id: "deepseek_niang",   name: "DeepSeek娘",        element: "network",  stats: { compute: 62, bandwidth: 58, stability: 70, cooling: 85 } },
    { id: "deepseek_niang_2", name: "DeepSeek娘·勤务班", element: "hardware", stats: { compute: 55, bandwidth: 52, stability: 74, cooling: 92 } },
    { id: "deepseek_niang_3", name: "DeepSeek娘·实习",   element: "compute",  stats: { compute: 48, bandwidth: 60, stability: 58, cooling: 70 } },
    { id: "rental_whale",     name: "租用·鲸鲸",         element: "anomaly",  stats: { compute: 50, bandwidth: 55, stability: 60, cooling: 65 } },
];

const n = parseInt(process.argv[2] || "200", 10);
const out = process.argv[3] || path.join(__dirname, "fixtures-stress.json");
const ri = (m) => Math.floor(Math.random() * m);
const pick = (arr) => arr[ri(arr.length)];

const cases = [];
for (let c = 0; c < n; c++) {
    const party = (side) => {
        const cnt = 1 + ri(3); // 1~3 只
        return Array.from({ length: cnt }, (_, i) => {
            const sp = pick(SPECIES);
            const skillCnt = 1 + ri(3);
            const skills = Array.from({ length: skillCnt }, () => pick(SKILL_IDS))
                .filter((v, i, a) => a.indexOf(v) === i);
            return {
                uid: `s${side}c${c}p${i}`,
                speciesId: sp.id,
                name: `${sp.name}(${side}${i})`,
                element: sp.element,
                stats: { ...sp.stats },
                skills: skills,
            };
        });
    };
    const a = party(0), b = party(1);
    const commands = [];
    for (let turn = 0; turn < rules.turn.maxTurns; turn++) {
        commands.push([randCmd(a.length), randCmd(b.length)]);
    }
    cases.push({ name: `stress-${String(c).padStart(3, "0")}`, seed: ri(4294967296), sideA: a, sideB: b, commands });
}

function randCmd(partySize) {
    const r = Math.random();
    if (r < 0.08) return null;
    if (r < 0.16 && partySize > 1) return { kind: "switch", index: ri(partySize) };
    return { kind: "skill", index: ri(3) };
}

fs.writeFileSync(out, JSON.stringify({ comment: "压力对拍用例，随机生成", cases }, null, 1));
console.log(`stress fixtures: ${n} cases -> ${out}`);
