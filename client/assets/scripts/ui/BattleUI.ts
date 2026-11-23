import { Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import { HomeModel } from '../home/HomeModel';
import { NetManager } from '../core/NetManager';
import { WxAdapter } from '../core/WxAdapter';
import { ConfigManager } from '../core/ConfigManager';
import { PetData, makePet, findSpecies } from '../pet/PetData';
import { UIBuilder } from './UIBuilder';
import { BattleService, LevelDef, rulesFromConfig } from '../battle/BattleService';
import { Frame, FrameEvent, TurnSnapshot } from '../battle/engine/BattleTypes';
import { BattlePetInput } from '../battle/engine/BattleTypes';

/**
 * BattleUI —— PVE 战斗界面（W3 MVP：托管自动战斗 + 帧驱动战报表现）
 * 流程：关卡列表 → 本地预演 → 服务端权威重放（在线）/本地权威（离线）
 * → 逐帧播放战报+血条 → 结算（奖励入账 / 捕获入队 / 存档双写）
 */
export class BattleUI extends Component {

    private model: HomeModel = null;
    private root: Node = null;
    private titleLabel: Label = null;
    private logLabel: Label = null;
    private actionBtn: Node = null;
    private barNodes: { [uid: string]: { fg: Node; text: Label; side: number; alive: boolean } } = {};
    private levelContainer: Node = null;
    private hpRows: Node = null;

    private hpState: { [uid: string]: { cur: number; max: number; name: string; side: number; active: boolean } } = {};
    private curLevel: LevelDef = null;
    private frames: Frame[] = [];
    private frameIdx = 0;
    private pendingCapture: { recordId: number; level: LevelDef } = null;

    private static _instance: BattleUI = null;
    public static get instance(): BattleUI { return BattleUI._instance; }

    /** 由 Bootstrap 创建常驻（默认隐藏） */
    public static create(parent: Node): void {
        const n = new Node('BattleUI');
        n.setParent(parent);
        BattleUI._instance = n.addComponent(BattleUI);
        BattleUI._instance.model = HomeModel.instance;
        BattleUI._instance.buildUI();
        n.active = false;
    }

    public show(): void {
        // 置顶到 Canvas 兄弟节点最末，确保盖过 HomeUI
        if (this.node.parent) this.node.setSiblingIndex(this.node.parent.children.length - 1);
        this.node.active = true;
        this.enterLevelList();
    }

    private hide(): void {
        if (this.sessionId) {
            NetManager.pveInteractiveAbandon(this.sessionId);
            this.sessionId = null;
        }
        this.node.active = false;
        this.unscheduleAllCallbacks();
    }

    // ---------------- UI 构建 ----------------

    private buildUI() {
        const bg = UIBuilder.panel('battleBg', this.node, 720, 1280, 0, 0, new Color(24, 28, 40, 255));
        this.titleLabel = UIBuilder.label('title', bg, '处理麻烦', 34, -360, 560, Color.WHITE, 600).getComponent(Label);
        const closeBtn = UIBuilder.button('close', bg, 90, 54, 280, 560, '返回', () => {
            if (this.node.active) { this.hide(); }
        }, new Color(120, 60, 60, 255));
        void closeBtn;

        // 血条行容器（敌方上/我方下）
        this.hpRows = UIBuilder.node('hpRows', bg, 680, 700, 0, 130);

        // 战报区（⚠ Label 必须放子节点，同节点 Graphics 会吞掉渲染）
        const logBg = UIBuilder.panel('logBg', bg, 640, 140, 0, -370, new Color(14, 16, 26, 255));
        const logNode = UIBuilder.label('logText', logBg, '', 18, 0, 0, new Color(200, 210, 230, 255), 600);
        logNode.getComponent(UITransform).setContentSize(600, 120);
        this.logLabel = logNode.getComponent(Label);
        this.logLabel.overflow = Label.Overflow.CLAMP;
        this.logLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.logLabel.verticalAlign = Label.VerticalAlign.BOTTOM;
        void logBg;

        this.levelContainer = UIBuilder.node('levelList', bg, 680, 640, 0, 80);
        this.actionBtn = UIBuilder.button('action', bg, 260, 80, 0, -540, '返回', () => this.enterLevelList(), new Color(60, 120, 90, 255));
        this.actionBtn.active = false;

        // 页签：PVE / PVP（W4）
        UIBuilder.button('tab_pve', bg, 160, 60, -110, 470, '处理麻烦', () => this.enterLevelList(), new Color(40, 80, 130, 255));
        UIBuilder.button('tab_pvp', bg, 160, 60, 70, 470, '切磋', () => this.enterPvpMenu(), new Color(130, 70, 40, 255));
    }

    private clearContainer(c: Node) {
        for (const child of c.children.slice()) child.destroy();
        c.removeAllChildren();
    }

    private log(line: string) {
        this.logLabel.string = (this.logLabel.string ? this.logLabel.string + '\n' : '') + line;
        const lines = this.logLabel.string.split('\n');
        if (lines.length > 12) this.logLabel.string = lines.slice(lines.length - 12).join('\n');
    }

    // ---------------- 关卡列表 ----------------

    private enterLevelList() {
        this.unscheduleAllCallbacks();
        this.titleLabel.string = '处理麻烦';
        this.actionBtn.active = false;
        this.clearContainer(this.hpRows);
        this.logLabel.string = '';
        this.barNodes = {};
        this.curLevel = null;
        this.clearContainer(this.levelContainer);

        const levels = this.getLevels();
        if (levels.length === 0) {
            this.log('⚠ 关卡配置缺失（检查服务端 levels 配置包）');
            return;
        }
        levels.forEach((lv, i) => {
            const btn = UIBuilder.button(`lv_${lv.id}`, this.levelContainer, 640, 92, 0, 270 - i * 100,
                '', () => this.startBattle(lv), new Color(50, 90, 140, 255));
            const label = btn.getChildByName(`lv_${lv.id}_lb`);
            if (label) label.getComponent(Label).string = `${lv.name}${lv.captureRate > 0 ? '  [可捕获]' : ''}`;
        });
        this.log('选择一个要处理的麻烦（托管自动战斗）');
    }

    /** 关卡来源：ConfigManager 三级（服务端 → 缓存 → 垫脚片） */
    private getLevels(): LevelDef[] {
        const levelsCfg = ConfigManager.get('levels');
        return (levelsCfg && levelsCfg.levels ? levelsCfg.levels : []) as LevelDef[];
    }

    // ---------------- 异步 PVP（W4） ----------------

    private myScore = -1;

    private enterPvpMenu() {
        this.unscheduleAllCallbacks();
        this.titleLabel.string = '切磋';
        this.actionBtn.active = false;
        this.clearContainer(this.hpRows);
        this.logLabel.string = '';
        this.barNodes = {};
        this.curLevel = null;
        this.clearContainer(this.levelContainer);

        if (!NetManager.online) {
            this.log('⚠ 切磋需要联网（异步 PVP 由服务端权威结算）');
            return;
        }
        const scoreText = this.myScore >= 0 ? `我的积分: ${this.myScore}` : '';
        UIBuilder.button('pvp_defense', this.levelContainer, 640, 92, 0, 250,
            '', () => this.uploadDefense(), new Color(70, 100, 60, 255));
        const lb1 = this.levelContainer.getChildByName('pvp_defense');
        if (lb1) {
            const l = lb1.getChildByName('pvp_defense_lb');
            if (l) l.getComponent(Label).string = '① 设置防守阵容（当前出战）';
        }
        UIBuilder.button('pvp_challenge', this.levelContainer, 640, 92, 0, 130,
            '', () => this.startPvpBattle(), new Color(150, 90, 50, 255));
        const lb2 = this.levelContainer.getChildByName('pvp_challenge');
        if (lb2) {
            const l = lb2.getChildByName('pvp_challenge_lb');
            if (l) l.getComponent(Label).string = '② 挑战对手（匹配相近积分）';
        }
        UIBuilder.button('pvp_rank', this.levelContainer, 640, 92, 0, 10,
            '', () => this.enterRanking(), new Color(90, 70, 130, 255));
        const lb3 = this.levelContainer.getChildByName('pvp_rank');
        if (lb3) {
            const l = lb3.getChildByName('pvp_rank_lb');
            if (l) l.getComponent(Label).string = '排行榜';
        }
        this.log(`${scoreText}胜 +25 分 / 负 -10 分，防守阵容会在离线时替你迎战`);
    }

    private uploadDefense() {
        const party = this.buildParty();
        if (party.length === 0) {
            this.log('⚠ 没有可防守的 AI 娘（过热宕机的不能上）');
            return;
        }
        NetManager.pvpSetDefense({ party, mainName: party[0].name }).then((profile) => {
            this.myScore = profile.score;
            this.log(`✓ 防守阵容已部署（${party.map(p => p.name).join('/')}），积分 ${profile.score}`);
        }).catch((e) => this.log(`防守阵容上传失败: ${e.message}`));
    }

    private startPvpBattle() {
        if (this.model.pets.length === 0) {
            this.log('⚠ 你还没有 AI 娘，先去领养一只！');
            return;
        }
        const party = this.buildParty();
        if (party.length === 0) {
            this.log('⚠ 没有 可出战的 AI 娘（过热宕机的不能打）');
            return;
        }
        this.log('→ 匹配对手并提交服务端结算…');
        const seed = BattleService.randomSeed();
        const rulesCfg = this.getBattleRulesConfig();
        const rules = rulesFromConfig(rulesCfg);
        // 挑战者指令（防守方指令由服务端托管生成）
        const commands = BattleService.planCommands(rules.turn.maxTurns);

        NetManager.pvpChallenge({ seed, party, commands }).then((res) => {
            // 服务端返回 level（含对手阵容快照）→ 用它渲染血条
            this.curLevel = res.level;
            this.frames = res.frames;
            this.playFrames(res.result, res.rewards || {}, res.user, res.recordId);
        }).catch((e) => this.log(`挑战失败: ${e.message}`));
    }

    private enterRanking() {
        this.clearContainer(this.levelContainer);
        this.logLabel.string = '';
        this.log('→ 拉取排行榜…');
        NetManager.pvpRanking().then((rows) => {
            this.clearContainer(this.levelContainer);
            rows.slice(0, 8).forEach((r, i) => {
                UIBuilder.button(`rank_${r.userId}`, this.levelContainer, 640, 76, 0, 260 - i * 84,
                    '', () => { /* 查看阵容（W5） */ }, new Color(i === 0 ? 160 : 70, i === 0 ? 130 : 80, i === 0 ? 60 : 110, 255));
                const btn = this.levelContainer.getChildByName(`rank_${r.userId}`);
                if (btn) {
                    const l = btn.getChildByName(`rank_${r.userId}_lb`);
                    if (l) l.getComponent(Label).string = `${i + 1}. ${r.nickname}  ${r.score}分 (${r.wins}胜${r.losses}负)`;
                }
            });
            this.log(rows.length === 0 ? '排行榜还是空的，快去上传防守阵容！' : `共 ${rows.length} 人上榜`);
        }).catch((e) => this.log(`排行榜拉取失败: ${e.message}`));
    }

    private getBattleRulesConfig(): any {
        return ConfigManager.get('battle-rules');
    }

    // ---------------- 战斗流程 ----------------

    private startBattle(level: LevelDef) {
        if (this.model.pets.length === 0) {
            this.log('⚠ 你还没有 AI 娘，先去领养一只！');
            return;
        }
        const party = this.buildParty();
        if (party.length === 0) {
            this.log('⚠ 没有 可出战的 AI 娘（过热宕机的不能打）');
            return;
        }
        this.curLevel = level;

        // 在线：交互式逐回合（W5 主体）；离线：托管降级
        if (NetManager.online) {
            this.log('→ 建立战斗会话…');
            NetManager.pveInteractiveStart({ levelId: level.id, seed: BattleService.randomSeed(), party }).then((res) => {
                this.sessionId = res.sessionId;
                this.curLevel = res.level; // 服务端权威敌方阵容
                this.interactiveTurn = res.turn;
                this.enterInteractiveStage();
            }).catch((e) => {
                console.warn('[Battle] 交互式开局失败，降级托管:', e);
                this.startAutoBattle(level);
            });
        } else {
            this.startAutoBattle(level);
        }
    }

    // ---------------- 交互式逐回合（W5） ----------------

    private sessionId: string | null = null;
    private interactiveTurn = 0;
    private curSnapshot: TurnSnapshot | null = null;

    private enterInteractiveStage() {
        this.unscheduleAllCallbacks();
        this.clearContainer(this.levelContainer);
        this.clearContainer(this.hpRows);
        this.titleLabel.string = this.curLevel.name;
        this.logLabel.string = '';
        this.barNodes = {};
        this.curSnapshot = null;
        this.buildHpRows();
        this.buildCommandBar();
        this.log(`T${this.interactiveTurn} 选择行动`);
    }

    /** 行动条：在场宠技能（含剩余 PP）+ 换宠 */
    private buildCommandBar() {
        this.clearContainer(this.levelContainer);
        const party = this.buildParty();
        const rulesCfg = this.getBattleRulesConfig();
        const rules = rulesFromConfig(rulesCfg);
        const skillDefs = rules.skills;

        // 在场宠 = 快照 active；无快照（首回合）= party[0]
        let activeUid = party.length ? party[0].uid : '';
        let activePP: number[] = [];
        if (this.curSnapshot) {
            const active = this.curSnapshot.pets.find(p => p.side === 0 && p.active);
            if (active) { activeUid = active.uid; activePP = active.pp; }
        }
        const pet = party.find(p => p.uid === activeUid) || party[0];
        if (!pet) return;

        // 技能按钮（≤3 个横排，避开战报区）
        const btnW = 198, gap = 8;
        pet.skills.forEach((skillId, i) => {
            const def = skillDefs[skillId];
            // 无快照（首回合）显示满 PP；有快照用服务端权威剩余值
            const pp = activePP.length > i ? activePP[i] : (def ? def.ppMax : 1);
            const disabled = pp <= 0;
            const label = `${def ? def.name : skillId} PP:${pp}${disabled ? '(耗尽)' : ''}`;
            const btn = UIBuilder.button(`cmd_${i}`, this.levelContainer, btnW, 84, (i - 1) * (btnW + gap), -260,
                '', () => { if (!disabled) this.submitCommand({ kind: 'skill', index: i }); },
                disabled ? new Color(70, 70, 80, 255) : new Color(50, 110, 160, 255));
            const lb = btn.getChildByName(`cmd_${i}_lb`);
            if (lb) {
                const l = lb.getComponent(Label);
                l.string = label;
                l.fontSize = 17;
            }
        });

        // 换宠：替补中第一个存活的（窄条贴血条区下方）
        const backup = party.find(p => {
            if (p.uid === activeUid) return false;
            if (!this.curSnapshot) return true;
            const st = this.curSnapshot.pets.find(s => s.side === 0 && s.uid === p.uid);
            return st ? st.hp > 0 : true;
        });
        const switchBtn = UIBuilder.button('cmd_switch', this.levelContainer, 636, 50, 0, -175,
            '', () => {
                if (backup) this.submitCommand({ kind: 'switch', index: party.findIndex(p => p.uid === backup.uid) });
            }, new Color(110, 90, 50, 255));
        const slb = switchBtn.getChildByName('cmd_switch_lb');
        if (slb) {
            const l = slb.getComponent(Label);
            l.string = backup ? `换宠 → ${backup.name}` : '没有可换的替补';
            l.fontSize = 17;
        }
    }

    private submitCommand(cmd: { kind: string; index: number } | null) {
        if (!this.sessionId) return;
        this.clearContainer(this.levelContainer);
        this.log(`→ ${cmd ? (cmd.kind === 'switch' ? '换宠' : '使用技能') : '跳过'}…`);
        NetManager.pveInteractiveCommand({ sessionId: this.sessionId, command: cmd }).then((res) => {
            this.playTurnFrames(res.frames, () => {
                if (res.finished) {
                    this.sessionId = null;
                    this.interactiveTurn = res.turn;
                    this.enterSettle(res.winner, res.rewards || {}, res.user, res.recordId);
                } else {
                    this.interactiveTurn = res.turn + 1;
                    this.applySnapshot(res.snapshot);
                    this.buildCommandBar();
                }
            });
        }).catch((e) => {
            this.log(`指令提交失败: ${e.message}`);
            this.sessionId = null; // 会话失效（过期/销毁），回到托管
            this.buildCommandBar();
        });
    }

    /** 播放本回合帧（每帧 0.35s），播完回调 */
    private playTurnFrames(frames: Frame[], onDone: () => void) {
        if (!frames || frames.length === 0) { onDone(); return; }
        let idx = 0;
        this.schedule(() => {
            if (idx >= frames.length) {
                this.unscheduleAllCallbacks();
                onDone();
                return;
            }
            this.applyFrame(frames[idx]);
            idx++;
        }, 0.35);
    }

    /** 用服务端权威快照覆盖血条状态 */
    private applySnapshot(snapshot: TurnSnapshot) {
        this.curSnapshot = snapshot;
        for (const p of snapshot.pets) {
            const st = this.hpState[p.uid];
            if (!st) continue;
            st.cur = Math.floor(p.hp);
            st.active = p.active;
        }
        this.refreshBars();
    }

    /** 托管整场（离线降级 / 交互开局失败） */
    private startAutoBattle(level: LevelDef) {
        const party = this.buildParty();
        const seed = BattleService.randomSeed();
        const rulesCfg = this.getBattleRulesConfig();
        const rules = rulesFromConfig(rulesCfg);
        const commands = BattleService.planCommands(rules.turn.maxTurns);
        const local = BattleService.preview(seed, rules, party, level.enemies, commands);

        if (NetManager.online) {
            this.log('→ 托管提交服务端权威结算…');
            NetManager.battlePVE({ levelId: level.id, seed, party, commands }).then((res) => {
                this.frames = res.frames;
                this.playFrames(res.result, res.rewards || {}, res.user, res.recordId);
            }).catch(() => this.applyLocalResult(local, level, seed));
        } else {
            this.applyLocalResult(local, level, seed);
        }
    }

    private applyLocalResult(local: any, level: LevelDef, seed: number) {
        this.frames = local.frames;
        const rewards = local.result.winner === 0 ? level.rewards : {};
        // 本地权威：奖励直接入账（离线模式）
        this.grantLocalRewards(rewards);
        this.playFrames(local.result.winner, rewards, null, -1);
        void seed;
    }

    /** 存档前 3 只非宕机宠 → 引擎输入（存量存档 skills 不足 3 个时从种族池补齐） */
    private buildParty(): BattlePetInput[] {
        const out: BattlePetInput[] = [];
        for (const pet of this.model.pets) {
            if (pet.status === 'overheat') continue;
            const species = findSpecies(this.model.species, pet) || undefined;
            if (species && pet.skills.length < species.skillPool.length) {
                pet.skills = species.skillPool.slice(0, 3);
            }
            out.push(BattleService.petToInput(pet, species));
            if (out.length >= 3) break;
        }
        return out;
    }

    private grantLocalRewards(rewards: { [k: string]: number }) {
        const r = this.model.resources;
        if (rewards['coins']) r.gold += rewards['coins'];
        if (rewards['tokens']) r.token += rewards['tokens'];
        if (rewards['feed']) r.food += rewards['feed'];
        if (rewards['ice_packs']) r.coolPads += rewards['ice_packs'];
        this.model.persist();
        this.pushSave();
    }

    private pushSave() {
        // persist 内含本地落盘 + 云端异步推送（乐观锁）
        this.model.persist();
    }

    // ---------------- 帧播放 ----------------

    private playFrames(winner: number, rewards: { [k: string]: number }, userSnapshot: any, recordId: number) {
        this.clearContainer(this.levelContainer);
        this.titleLabel.string = this.curLevel.name;
        this.logLabel.string = '';
        this.buildHpRows();
        this.frameIdx = 0;
        this.pendingCapture = null;

        const onFinish = () => {
            this.enterSettle(winner, rewards, userSnapshot, recordId);
        };
        this.schedule(() => {
            if (this.frameIdx >= this.frames.length) {
                this.unscheduleAllCallbacks();
                onFinish();
                return;
            }
            this.applyFrame(this.frames[this.frameIdx]);
            this.frameIdx++;
        }, 0.35);
    }

    private buildHpRows() {
        this.clearContainer(this.hpRows);
        this.barNodes = {};
        this.hpState = {};
        const addRow = (uid: string, name: string, side: number, maxHp: number, y: number) => {
            const row = UIBuilder.panel(`row_${uid}`, this.hpRows, 640, 64, 0, y,
                side === 0 ? new Color(40, 60, 90, 255) : new Color(90, 50, 50, 255));
            UIBuilder.label('nm', row, name, 22, -300, 14, Color.WHITE, 240);
            const barBg = UIBuilder.panel('barBg', row, 260, 16, 40, -8, new Color(30, 30, 34, 255));
            void barBg;
            const fg = UIBuilder.panel('barFg', row, 260, 16, 40, -8, new Color(90, 200, 120, 255));
            const hpText = UIBuilder.label('hp', row, `${maxHp}/${maxHp}`, 18, 230, -2, Color.WHITE, 120).getComponent(Label);
            this.barNodes[uid] = { fg, text: hpText, side, alive: true };
            this.hpState[uid] = { cur: maxHp, max: maxHp, name, side, active: side === 0 };
        };
        // 敌方（最多3）y 280/216/152；我方 y -40/-104/-168（行距 64，给行动条留空间）
        this.curLevel.enemies.forEach((e, i) => {
            const maxHp = Math.floor(e.stats.cooling * 6);
            addRow(e.uid, e.name, 1, maxHp, 280 - i * 64);
        });
        this.buildParty().forEach((p, i) => {
            const maxHp = Math.floor(p.stats.cooling * 6);
            addRow(p.uid, p.name, 0, maxHp, -40 - i * 64);
        });
    }

    private applyFrame(frame: Frame) {
        for (const ev of frame.events) this.applyEvent(ev);
        if (frame.action === 'switch' || frame.action === 'faint_switch') {
            // 切换当前场上宠标记
            for (const uid in this.hpState) {
                if (this.hpState[uid].side === frame.side) this.hpState[uid].active = uid === frame.petUid;
            }
        }
        this.refreshBars();
        // 战报文字
        const desc = this.describeFrame(frame);
        if (desc) this.log(`T${frame.turn} ${desc}`);
    }

    private applyEvent(ev: FrameEvent) {
        const st = this.hpState[ev.petUid];
        if (!st) return;
        if (ev.type === 'damage') st.cur = Math.max(0, st.cur - ev.value);
        else if (ev.type === 'heal') st.cur = Math.min(st.max, st.cur + ev.value);
        else if (ev.type === 'faint') { st.cur = 0; st.active = false; }
        else if (ev.type === 'switchIn') {
            for (const uid in this.hpState) {
                if (this.hpState[uid].side === ev.side) this.hpState[uid].active = uid === ev.petUid;
            }
        }
    }

    private refreshBars() {
        for (const uid in this.barNodes) {
            const node = this.barNodes[uid];
            const st = this.hpState[uid];
            const ratio = Math.max(0, Math.min(1, st.cur / st.max));
            // Graphics 重画血条（fillColor 赋值不会触发重绘，必须 clear+rect+fill）
            const g = node.fg.getComponent(Graphics);
            if (g) {
                const w = 260 * ratio;
                g.clear();
                g.fillColor = ratio > 0.5 ? new Color(90, 200, 120, 255)
                    : ratio > 0.25 ? new Color(220, 180, 60, 255)
                        : new Color(210, 80, 80, 255);
                g.rect(-w / 2, -8, w, 16);
                g.fill();
            }
            node.fg.setPosition(40, -8, 0);
            node.text.string = `${st.cur}/${st.max}`;
        }
    }

    private describeFrame(frame: Frame): string {
        if (frame.action === 'skip') return `${this.nameOf(frame.petUid)} 无法行动`;
        if (frame.action === 'switch') return `${this.nameOf(frame.petUid)} 登场！`;
        if (frame.action === 'faint_switch') return `${this.nameOf(frame.petUid)} 补位登场！`;
        if (frame.action !== 'skill') return '';
        const skillName = frame.skillId || '';
        const parts: string[] = [];
        for (const ev of frame.events) {
            if (ev.type === 'damage') parts.push(`对 ${this.nameOf(ev.petUid)} 造成 ${ev.value} 伤害`);
            else if (ev.type === 'heal') parts.push(`恢复 ${ev.value} HP`);
            else if (ev.type === 'shield') parts.push('展开护盾');
            else if (ev.type === 'attackUp') parts.push('算力提升');
            else if (ev.type === 'faint') parts.push(`${this.nameOf(ev.petUid)} 宕机倒下！`);
        }
        return `${this.nameOf(frame.petUid)} 使用 [${skillName}]${parts.length ? '：' + parts.join('，') : ''}`;
    }

    private nameOf(uid: string): string {
        return this.hpState[uid] ? this.hpState[uid].name : uid;
    }

    // ---------------- 结算 ----------------

    private enterSettle(winner: number, rewards: { [k: string]: number }, userSnapshot: any, recordId: number) {
        this.actionBtn.active = true;
        const win = winner === 0;
        this.log(win ? '★ 战斗胜利！' : '▼ 战斗失败…');
        if (win) {
            const r = Object.keys(rewards).map(k => `${k}+${rewards[k]}`).join(' ');
            if (r) this.log(`奖励: ${r}`);
            void userSnapshot;
            // 分享触点：晒战报（微信环境调起分享面板，H5 仅日志）
            UIBuilder.button('btn_share', this.levelContainer, 300, 70, -160, -430,
                '', () => WxAdapter.shareReport('我在AI中转站打赢了一场切磋！'), new Color(60, 110, 140, 255));
            const sb = this.levelContainer.getChildByName('btn_share');
            if (sb) {
                const l = sb.getChildByName('btn_share_lb');
                if (l) l.getComponent(Label).string = '分享战报';
            }
            // 捕获结算
            const level = this.curLevel;
            if (level.captureSpecies && level.captureRate > 0) {
                if (NetManager.online && recordId > 0) {
                    NetManager.capturePet(recordId).then((res) => {
                        this.handleCapture(res.captured, res.speciesId, level);
                    }).catch((e) => this.log(`捕获结算失败: ${e.message}`));
                } else {
                    // 离线：本地掷骰（captureRate 语义同服务端）
                    const captured = Math.random() < level.captureRate;
                    this.handleCapture(captured, level.captureSpecies, level);
                }
            }
        } else {
            // 广告触点：战败看激励视频领补偿（feed+10；微信走真实广告位，H5 模拟）
            UIBuilder.button('btn_ad_feed', this.levelContainer, 300, 70, 160, -430,
                '', () => {
                    WxAdapter.showRewardedAd('adunit-debug-feed', () => {
                        this.grantLocalRewards({ feed: 10 });
                        this.log('✓ 广告奖励：算力饲料 +10');
                    }, (reason) => this.log(`广告未完成: ${reason}`));
                }, new Color(140, 110, 50, 255));
            const ab = this.levelContainer.getChildByName('btn_ad_feed');
            if (ab) {
                const l = ab.getChildByName('btn_ad_feed_lb');
                if (l) l.getComponent(Label).string = '看广告领饲料+10';
            }
        }
    }

    private handleCapture(captured: boolean, speciesId: string, level: LevelDef) {
        if (captured) {
            const species = this.model.species[speciesId];
            if (species) {
                const pet: PetData = makePet(species, species.name, 'deploy', 0, speciesId);
                pet.skills = species.skillPool.slice(0, 3);
                this.model.pets.push(pet);
                this.model.persist();
                this.pushSave();
                this.log(`✨ 捕获成功！${species.name} 加入了你的中转站！`);
            } else {
                this.log(`✨ 捕获成功！种族表缺失: ${speciesId}`);
            }
        } else {
            this.log(`捕获失败…（${level.name}）`);
        }
    }
}
