import { _decorator, Component, resources, Sprite, SpriteFrame } from 'cc';
import { PET_ART } from '../pet/PetData';

const { ccclass } = _decorator;

/**
 * PetView —— AI娘帧动画组件
 * 依据状态（normal/hungry/overheat/sad/working）循环播放对应切片帧。
 * 帧来源：art/deepseek-girl/{prefix}_{i}（构建期由脚本切片生成）。
 */
@ccclass('PetView')
export class PetView extends Component {

    private sprite: Sprite = null;
    private frames: SpriteFrame[] = [];
    private fps: number = 6;
    private idx: number = 0;
    private acc: number = 0;
    private loadedPrefix: string = '';

    onLoad() {
        this.sprite = this.getComponent(Sprite);
    }

    /** 按宠物状态切换动画（帧数据见 PET_ART.anim） */
    public playStatus(status: string, working = false): void {
        const anim = working ? PET_ART.anim.working
            : status === 'overheat' ? PET_ART.anim.overheat
            : (status === 'sad' || status === 'hungry') ? PET_ART.anim.sad
            : PET_ART.anim.normal;
        if (this.loadedPrefix === anim.prefix) return;
        this.loadedPrefix = anim.prefix;
        this.frames = [];
        this.idx = 0;
        for (let i = 0; i < anim.frames; i++) {
            const path = `${PET_ART.dir}/${anim.prefix}_${i}`;
            resources.load(`${path}/spriteFrame`, SpriteFrame, (err, frame) => {
                if (err) { console.warn('[PetView] 帧加载失败', path, err.message); return; }
                this.frames[i] = frame;
                if (i === 0 && this.sprite) this.sprite.spriteFrame = frame;
            });
        }
    }

    update(dt: number) {
        if (this.frames.length === 0 || !this.sprite) return;
        this.acc += dt;
        if (this.acc >= 1 / this.fps) {
            this.acc = 0;
            const f = this.frames[this.idx % this.frames.length];
            if (f) this.sprite.spriteFrame = f;
            this.idx = (this.idx + 1) % this.frames.length;
        }
    }
}
