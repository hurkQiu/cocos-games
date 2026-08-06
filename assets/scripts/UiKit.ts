import { Node, UITransform, Sprite, SpriteFrame, Label, Color, Button, BlockInputEvents, Graphics } from 'cc';

export interface ButtonSprites {
    normal: SpriteFrame | null;
    pressed: SpriteFrame | null;
    disabled: SpriteFrame | null;
}

/**
 * A plain flat-color rectangle (board backgrounds, cell tiles, bars), drawn
 * with Graphics. Cocos's built-in `default_sprite.png` is the editor's
 * "no image assigned" placeholder icon, not a blank fill texture, so a
 * solid-color rect must never be built by tinting a Sprite with it.
 */
export function createFlatRect(parent: Node, name: string, width: number, height: number, color: Color): Node {
    const node = new Node(name);
    node.parent = parent;
    const uiT = node.addComponent(UITransform);
    uiT.setContentSize(width, height);
    const g = node.addComponent(Graphics);
    g.fillColor = color;
    g.rect(-width / 2, -height / 2, width, height);
    g.fill();
    return node;
}

/**
 * Full-screen translucent click-blocking mask, drawn with Graphics rather
 * than a stretched 9-slice sprite so the translucency stays perfectly
 * uniform (a hugely up-scaled sprite's native pixels can show faint
 * gradient/AA artifacts that read as patchy transparency).
 */
export function createOverlayBackdrop(parent: Node, name: string, width: number, height: number): Node {
    const node = new Node(name);
    node.parent = parent;
    const uiT = node.addComponent(UITransform);
    uiT.setContentSize(width, height);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 150);
    g.rect(-width / 2, -height / 2, width, height);
    g.fill();
    node.addComponent(BlockInputEvents);
    return node;
}

/** Fully opaque solid modal panel (see createOverlayBackdrop for why Graphics, not a Sprite). */
export function createPanel(parent: Node, width: number, height: number): Node {
    const node = new Node('Panel');
    node.parent = parent;
    const uiT = node.addComponent(UITransform);
    uiT.setContentSize(width, height);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(245, 245, 240, 255);
    g.roundRect(-width / 2, -height / 2, width, height, 16);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = new Color(190, 195, 195, 255);
    g.roundRect(-width / 2, -height / 2, width, height, 16);
    g.stroke();
    return node;
}

export function createLabel(parent: Node, text: string, x: number, y: number, fontSize: number, color: Color): Label {
    const node = new Node('Label');
    node.parent = parent;
    node.setPosition(x, y, 0);
    const uiT = node.addComponent(UITransform);
    uiT.setContentSize(parent.getComponent(UITransform)!.contentSize.width, fontSize * 1.6);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 6;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.NONE;
    label.color = color;
    return label;
}

/**
 * A multi-line text block that auto-wraps to `width` and grows downward
 * from `y` (top-anchored), instead of the single-line labels `createLabel`
 * makes. Use this for rules text and other paragraph-length copy so long
 * lines can't run past the panel width.
 */
export function createWrappedLabel(parent: Node, text: string, x: number, y: number, width: number, fontSize: number, color: Color): Label {
    const node = new Node('Label');
    node.parent = parent;
    node.setPosition(x, y, 0);
    const uiT = node.addComponent(UITransform);
    uiT.setContentSize(width, fontSize * 1.6);
    uiT.setAnchorPoint(0.5, 1);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.floor(fontSize * 1.4);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.TOP;
    label.overflow = Label.Overflow.RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.color = color;
    return label;
}

export function createButton(
    parent: Node,
    sprites: ButtonSprites,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    onClick: () => void,
): Node {
    const node = new Node(`Btn_${text}`);
    node.parent = parent;
    node.setPosition(x, y, 0);
    const uiT = node.addComponent(UITransform);
    uiT.setContentSize(width, height);

    const sprite = node.addComponent(Sprite);
    sprite.type = Sprite.Type.SLICED;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    if (sprites.normal) {
        sprite.spriteFrame = sprites.normal;
    }

    const btn = node.addComponent(Button);
    btn.transition = Button.Transition.SPRITE;
    btn.target = node;
    if (sprites.normal) {
        btn.normalSprite = sprites.normal;
    }
    if (sprites.pressed) {
        btn.pressedSprite = sprites.pressed;
        btn.hoverSprite = sprites.pressed;
    }
    if (sprites.disabled) {
        btn.disabledSprite = sprites.disabled;
    }

    const labelNode = new Node('Label');
    labelNode.parent = node;
    const lUiT = labelNode.addComponent(UITransform);
    lUiT.setContentSize(width, height);
    const label = labelNode.addComponent(Label);
    label.string = text;
    label.fontSize = Math.floor(height * 0.4);
    label.lineHeight = label.fontSize + 4;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.color = new Color(40, 40, 40, 255);

    node.on(Button.EventType.CLICK, onClick);
    return node;
}
