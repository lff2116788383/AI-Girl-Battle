/**
 * 对拍 TS 侧入口 —— 由 esbuild bundle 为 node 可执行脚本（不走 Cocos）。
 * 用法: node replay-ts.cjs <fixtures.json> <battle-rules.json>
 * 输出: {"results":[{"name","winner","turns","frames":[...]}]}，结构与 Go 端一致
 */
import { readFileSync } from "fs";
import { runBattle } from "../../client/assets/scripts/battle/engine/BattleEngine";
import { BattleRules, BattleInput, BattleCommand, BattlePetInput } from "../../client/assets/scripts/battle/engine/BattleTypes";

interface Case {
    name: string;
    seed: number;
    sideA: BattlePetInput[];
    sideB: BattlePetInput[];
    commands: BattleCommand[][];
}

const [, , fixturesPath, rulesPath] = process.argv;
if (!fixturesPath || !rulesPath) {
    console.error("usage: node replay-ts.cjs <fixtures.json> <battle-rules.json>");
    process.exit(1);
}

const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
const rules: BattleRules = JSON.parse(readFileSync(rulesPath, "utf8"));

const results = fixtures.cases.map((c: Case) => {
    const input: BattleInput = {
        seed: c.seed >>> 0,
        rules: rules,
        sides: [c.sideA, c.sideB],
        commands: c.commands,
    };
    const out = runBattle(input);
    return {
        name: c.name,
        winner: out.result.winner,
        turns: out.result.turns,
        frames: out.frames,
        snapshots: out.snapshots,
    };
});

process.stdout.write(JSON.stringify({ results: results }));
