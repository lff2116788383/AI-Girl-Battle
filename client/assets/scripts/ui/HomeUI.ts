import { _decorator, Component, Color, Node } from 'cc';
import { HomeModel } from '../home/HomeModel';
import { PetData } from '../pet/PetData';
import { PetView } from './PetView';
import { UIBuilder } from './UIBuilder';

const { ccclass } = _decorator;

/**
 * HomeUI —— 中转站主界面（方案文档 §5.2 home 场景）
 * 代码动态构建，不依赖编辑器拖拽：
 *  顶栏：资源状态（金币/Token/饲料/冰垫）+ 平台标识
 *  左列：四设施卡片（宿舍/电闸/风扇/小厨房）+ 升级按钮
 *  中部：AI娘花名册（立绘帧动画 + 状态），点击过热的AI娘用冰垫救回
 *  底部：结算预览 / 执行结算 / 调试拨快一天 / 日志区
 *
 * 使用方式：编辑器里新建 home 场景 → Canvas 下建空节点 → 挂本组件 → 运行。
 */
@ccclass('HomeUI')
export class HomeUI extends Component {

    private model: HomeModel = null;
    private resLabels: { [key: string]: Node } = {};
    private facilityNodes: { [key: string]: { name: Node; detail: Node } } = {};
    private petNodes: { petId: string; root: Node; view: PetView; status: Node }[] = [];
    private logLabel: Node = null;
    private tripMask: Node = null;

    async start() {
        this.model = HomeModel.instance;
        await this.model.init();
        this.buildUI();
        this.refresh();
    }

    // ================= 布局 =================

    private buildUI() {
        const W = 720, H = 1280;

        // 背景板
        UIBuilder.panel('bg', this.node, W, H, 0, 0, new Color(28, 32, 44, 255));

        // ---- 顶栏：资源 ----
        const top = UIBuilder.panel('topbar', this.node, W, 120, 0, H / 2 - 60, new Color(44, 52, 70, 255));
        const defs = [
            ['gold', '金币'], ['token', 'Token'], ['food', '饲料'], ['coolPads', '冰垫'],
        ];
        defs.forEach(([key, cn], i) => {
            const x = -W / 2 + 110 + i * 175;
            UIBuilder.label(`lb_${key}_name`, top, cn, 24, x - 60, 24, new Color(160, 170, 190, 255), 120);
            this.resLabels[key] = UIBuilder.label(`lb_${key}`, top, '0', 30, x - 60, -16, Color.WHITE, 140);
        });

        // ---- 左列：设施卡片 ----
        const fx = -W / 2 + 130;
        const keys: (keyof typeof this.model.facilities)[] = ['dormitory', 'power', 'fan', 'kitchen'];
        keys.forEach((key, i) => {
            const y = H / 2 - 240 - i * 150;
            const card = UIBuilder.panel(`fac_${key}`, this.node, 240, 130, fx, y, new Color(40, 48, 66, 255));
            const name = UIBuilder.label(`fac_${key}_name`, card, '', 28, -95, 36, new Color(120, 200, 255, 255), 220);
            const detail = UIBuilder.label(`fac_${key}_detail`, card, '', 22, -95, -6, new Color(200, 205, 215, 255), 220);
            this.facilityNodes[key as string] = { name, detail };
            UIBuilder.button(`btn_up_${key}`, card, 200, 40, 0, -44, '升级',
                () => this.onUpgrade(key as any), new Color(60, 110, 190, 255));
        });

        // ---- 中部：AI娘花名册 ----
        const rosterX = W / 2 - 200;
        this.model.pets.forEach((pet, i) => {
            const y = H / 2 - 240 - (i % 4) * 260;
            const card = UIBuilder.panel(`pet_${pet.id}`, this.node, 260, 240, rosterX, y, new Color(36, 44, 62, 255));
            // 立绘（帧动画）
            const viewNode = UIBuilder.node(`view_${pet.id}`, card, 180, 150, 0, 40);
            const sp = viewNode.addComponent(cc.Sprite);
            sp.sizeMode = cc.Sprite.SizeMode.RAW;
            const view = viewNode.addComponent(PetView);
            // 名字与状态
            const nameLb = UIBuilder.label(`pet_${pet.id}_name`, card, pet.name, 24, -110, -50, Color.WHITE, 220);
            const statusLb = UIBuilder.label(`pet_${pet.id}_status`, card, '', 20, -110, -84, new Color(150, 210, 160, 255), 220);
            this.petNodes.push({ petId: pet.id, root: card, view, status: statusLb });
            nameLb; // 引用防优化
            // 点击AI娘：过热时用冰垫救回
            card.on(cc.Node.EventType.TOUCH_END, () => this.onPetTap(pet));
        });

        // ---- 底部：操作区 + 日志 ----
        const by = -H / 2 + 260;
        UIBuilder.button('btn_preview', this.node, 220, 64, -220, by, '结算预览',
            () => this.onPreview(), new Color(80, 140, 90, 255));
        UIBuilder.button('btn_settle', this.node, 220, 64, 20, by, '执行每日结算',
            () => this.onSettle(), new Color(160, 90, 70, 255));
        UIBuilder.button('btn_debug_day', this.node, 180, 64, 250, by, '调试:+1天',
            () => this.onDebugDay(), new Color(90, 90, 110, 255));

        this.logLabel = UIBuilder.label('log', this.node, '中转站日常待办：交电费、买饲料、看风扇。',
            22, -W / 2 + 30, -H / 2 + 130, new Color(190, 195, 210, 255), W - 60);
        (this.logLabel.getComponent(cc.Label) as any).overflow = cc.Label.Overflow.HEIGHT_ALIGNMENT;

        // 跳闸遮罩（默认隐藏）
        this.tripMask = UIBuilder.panel('tripMask', this.node, W, H, 0, 0, new Color(20, 20, 26, 220));
        this.tripMask.setPosition(0, 0, 0);
        const tripText = UIBuilder.label('tripText', this.tripMask, '⚡ 欠费跳闸！全站停摆\n（调试按钮拨快时间后可再次结算恢复）',
            36, 0, 80, new Color(255, 210, 90, 255), 600);
        tripText.getComponent(cc.Label).horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        UIBuilder.button('btn_trip_close', this.tripMask, 240, 70, 0, -60, '知道了',
            () => { this.tripMask.active = false; }, new Color(120, 120, 140, 255));
        this.tripMask.active = false;
    }

    // ================= 刷新 =================

    private refresh() {
        const m = this.model;
        // 资源
        this.resLabels.gold.getComponent(cc.Label).string = `${m.resources.gold}`;
        this.resLabels.token.getComponent(cc.Label).string = `${m.resources.token}`;
        this.resLabels.food.getComponent(cc.Label).string = `${m.resources.food}`;
        this.resLabels.coolPads.getComponent(cc.Label).string = `${m.resources.coolPads}`;
        // 设施
        for (const key of Object.keys(this.facilityNodes)) {
            const def = m.facilityDefs[key];
            const lv = (m.facilities as any)[key];
            const lvDef = def.levels.find(l => l.lv === lv);
            let cap = '';
            if (key === 'dormitory') cap = `床位 ${lvDef['beds']}（部署 ${m.deployedCount()}）`;
            if (key === 'power') cap = `供电 ${m.powerCap()}W（用 ${m.powerUsed()}W）`;
            if (key === 'fan') cap = `散热 ${m.coolingCap()}（热 ${m.heatUsed()}）`;
            if (key === 'kitchen') cap = `产能 ${lvDef['foodPerDay']} 饲料/日`;
            this.facilityNodes[key].name.getComponent(cc.Label).string = `${def.name} Lv.${lv}`;
            this.facilityNodes[key].detail.getComponent(cc.Label).string = `${cap}\n升级: ${lvDef['upgradeCost'].gold} 金币`;
        }
        // AI娘状态
        for (const pn of this.petNodes) {
            const pet = m.pets.find(p => p.id === pn.petId) as PetData;
            if (!pet) continue;
            const left = (pet as any).left;
            pn.status.getComponent(cc.Label).string = left ? '已离场'
                : `Lv.${pet.level} ★${pet.star} ${statusText(pet)} 心情:${pet.mood}`;
            pn.status.getComponent(cc.Label).color = statusColor(pet);
            pn.view.playStatus(pet.status, false);
        }
        // 跳闸遮罩
        this.tripMask.active = m.trippedUntil > Date.now();
    }

    // ================= 交互 =================

    private appendLog(lines: string[]) {
        const l = this.logLabel.getComponent(cc.Label);
        l.string = lines.join('\n') + '\n———\n' + l.string;
    }

    private onUpgrade(key: any) {
        const r = this.model.upgradeFacility(key);
        this.appendLog([r.msg]);
        this.refresh();
    }

    private onPreview() {
        const r = this.model.previewSettlement();
        const lines = ['── 结算预览（不落盘）──'];
        for (const b of r.bill) lines.push(`${b.item}: ${b.delta >= 0 ? '+' : ''}${b.delta}  ${b.note || ''}`);
        for (const s of r.statusUpdates) lines.push(`⚠ ${s.note}`);
        this.appendLog(lines);
        this.refresh();
    }

    private onSettle() {
        const r = this.model.runSettlement();
        const lines = [`── 每日结算完成（离线收益 +${r.offlineIncome}）──`];
        for (const b of r.bill) lines.push(`${b.item}: ${b.delta >= 0 ? '+' : ''}${b.delta}  ${b.note || ''}`);
        for (const s of r.statusUpdates) lines.push(`⚠ ${s.note}`);
        this.appendLog(lines);
        this.refresh();
    }

    private onDebugDay() {
        this.model.debugAdvanceDays(1);
        this.appendLog(['[调试] 时间拨快 1 天']);
        this.refresh();
    }

    private onPetTap(pet: PetData) {
        if (pet.status === 'overheat') {
            const r = this.model.rescueOverheat(pet.id);
            this.appendLog([r.msg]);
            this.refresh();
        }
    }
}

/** 状态文案 */
function statusText(pet: PetData): string {
    if ((pet as any).left) return '已离场';
    switch (pet.status) {
        case 'hungry': return '断粮蔫了';
        case 'overheat': return '过热宕机';
        case 'sad': return '心情低落';
        default: return pet.source === 'rent' ? '租用中' : '正常';
    }
}

function statusColor(pet: PetData): Color {
    if ((pet as any).left) return new Color(130, 130, 140, 255);
    switch (pet.status) {
        case 'overheat': return new Color(255, 120, 100, 255);
        case 'hungry': return new Color(230, 180, 90, 255);
        case 'sad': return new Color(150, 160, 220, 255);
        default: return new Color(150, 210, 160, 255);
    }
}
