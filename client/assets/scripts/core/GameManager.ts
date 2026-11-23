import { _decorator, Component, director } from 'cc';
import { WxAdapter } from './WxAdapter';
import { HomeModel } from '../home/HomeModel';

const { ccclass } = _decorator;

/**
 * GameManager —— 全局引导（方案文档 §5.3）
 * 挂在 home 场景 Canvas 下的空节点上，与 HomeUI 同节点或任意节点均可。
 */
@ccclass('GameManager')
export class GameManager extends Component {

    private static _instance: GameManager = null;
    public static get instance(): GameManager { return GameManager._instance; }

    async onLoad() {
        if (GameManager._instance === null) {
            GameManager._instance = this;
            director.addPersistRootNode(this.node);
            console.log(`[GameManager] 平台: ${WxAdapter.platform}，初始化家园系统...`);
            await HomeModel.instance.init();
            console.log('[GameManager] 家园系统就绪');
        } else {
            this.node.destroy();
        }
    }
}
