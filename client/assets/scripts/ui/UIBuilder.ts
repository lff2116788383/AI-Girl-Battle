import { Color, Graphics, Label, Node, UITransform } from 'cc';

/**
 * UIBuilder —— 代码动态构建 UI 的工具集（MVP 方案：先跑通逻辑，美术化时再进编辑器精修）
 * 纯色块用 Graphics 实现，零美术资源依赖。
 * 注意：枚举统一走 Label.HorizontalAlign / Label.Overflow 类命名空间，
 * 直接 import 枚举名在构建产物中会被 tree-shake 成 undefined。
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

    /** 纯色块节点（按钮底/面板底）：Graphics 画矩形，无需任何图片资源 */
    public static panel(name: string, parent: Node, w: number, h: number, x: number, y: number, color: Color): Node {
        const n = UIBuilder.node(name, parent, w, h, x, y);
        const g = n.addComponent(Graphics);
        g.fillColor = color;
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        return n;
    }

    /** 文本节点 */
    public static label(name: string, parent: Node, text: string, size: number, x: number, y: number,
        color = Color.WHITE, w = 400): Node {
        const n = UIBuilder.node(name, parent, w, size * 1.4, x, y);
        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = size;
        l.lineHeight = size * 1.4;
        l.color = color;
        l.overflow = Label.Overflow.SHRINK;
        l.horizontalAlign = Label.HorizontalAlign.LEFT;
        l.verticalAlign = Label.VerticalAlign.CENTER;
        return n;
    }

    /** 按钮：色块 + 文本 + 点击回调。
     * ⚠ 文本必须放子节点 —— Cocos 同节点多个 Renderable 组件（Graphics+Label）只有第一个会被渲染。 */
    public static button(name: string, parent: Node, w: number, h: number, x: number, y: number,
        text: string, onClick: () => void, bg = new Color(70, 130, 200, 255)): Node {
        const n = UIBuilder.panel(name, parent, w, h, x, y, bg);
        const lb = UIBuilder.label(name + '_lb', n, text, Math.floor(h * 0.42), 0, 0, Color.WHITE, w);
        lb.getComponent(Label).horizontalAlign = Label.HorizontalAlign.CENTER;
        lb.getComponent(Label).verticalAlign = Label.VerticalAlign.CENTER;
        n.on(Node.EventType.TOUCH_END, () => { onClick(); });
        return n;
    }
}
