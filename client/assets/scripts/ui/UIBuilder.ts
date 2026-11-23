import { Color, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';

/**
 * UIBuilder —— 代码动态构建 UI 的工具集（MVP 方案：先跑通逻辑，美术化时再进编辑器精修）
 */
export class UIBuilder {

    /** 创建带尺寸的空节点 */
    public static node(name: string, parent: Node, w: number, h: number, x = 0, y = 0): Node {
        const n = new Node(name);
        n.setParent(parent);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(w, h);
        return n;
    }

    /** 纯色块节点（按钮底/面板底） */
    public static panel(name: string, parent: Node, w: number, h: number, x: number, y: number, color: Color): Node {
        const n = UIBuilder.node(name, parent, w, h, x, y);
        const sp = n.addComponent(Sprite);
        sp.type = Sprite.Type.SIMPLE;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.color = color;
        return n;
    }

    /** 文本节点 */
    public static label(name: string, parent: Node, text: string, size: number, x: number, y: number, color = Color.WHITE, w = 400): Node {
        const n = UIBuilder.node(name, parent, w, size * 1.4, x, y);
        const l = n.addComponent(cc.Label);
        l.string = text;
        l.fontSize = size;
        l.lineHeight = size * 1.4;
        l.color = color;
        l.overflow = cc.Label.Overflow.SHRINK;
        l.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        l.verticalAlign = cc.Label.VerticalAlign.CENTER;
        return n;
    }

    /** 按钮：色块 + 文本 + 点击回调 */
    public static button(name: string, parent: Node, w: number, h: number, x: number, y: number,
        text: string, onClick: () => void, bg = new Color(70, 130, 200, 255)): Node {
        const n = UIBuilder.panel(name, parent, w, h, x, y, bg);
        const l = n.addComponent(cc.Label);
        l.string = text;
        l.fontSize = Math.floor(h * 0.42);
        l.color = Color.WHITE;
        l.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        l.verticalAlign = cc.Label.VerticalAlign.CENTER;
        n.on(cc.Node.EventType.TOUCH_END, () => { onClick(); });
        return n;
    }

    /** 从 resources 动态加载单帧图片 */
    public static loadFrame(relPath: string, cb: (frame: SpriteFrame) => void): void {
        resources.load(`${relPath}/spriteFrame`, SpriteFrame, (err, frame) => {
            if (err) { console.error('[UIBuilder] 加载图片失败:', relPath, err); return; }
            cb(frame);
        });
    }
}

// cc 命名空间部分类型在 strict 关闭下直接使用（Cocos 全局注入）
declare const cc: any;
