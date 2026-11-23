import { director, Director, game, Game, Node } from 'cc';
import { HomeUI } from '../ui/HomeUI';
import { WxAdapter } from './WxAdapter';

/**
 * Bootstrap —— 自启动引导（模块顶层代码，无需在场景中挂载任何自定义组件）
 *
 * 原理：Cocos Creator 构建时会把 assets 下所有脚本打进包并在启动时执行模块顶层代码，
 * 这里在「启动场景加载完成」事件里动态创建 HomeRoot 节点并挂载 HomeUI。
 * 好处：场景文件只含引擎内置类型（Canvas/Camera），手工生成/维护成本最低。
 */
game.on(Game.EVENT_GAME_INITED, () => {
    console.log(`[Bootstrap] 平台: ${WxAdapter.platform}`);
    director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
        const scene = director.getScene();
        if (!scene) { console.error('[Bootstrap] 启动场景为空'); return; }
        // ⚠️ 2D UI 必须挂在 Canvas 下：UI 相机的世界坐标基准是 Canvas 中心
        const canvas = scene.getChildByName('Canvas');
        const root = new Node('HomeRoot');
        (canvas ?? scene).addChild(root);
        root.addComponent(HomeUI);
        console.log('[Bootstrap] HomeUI 已挂载至', canvas ? 'Canvas' : 'Scene', '，家园系统启动');
    });
});
