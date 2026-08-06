import { _decorator, Component, Node, Graphics, Label, Color, UITransform, EventMouse, Button, tween, Tween, Vec3 } from 'cc';
import type { Mine } from './Mine';
const { ccclass } = _decorator;

const COLOR_COVERED = new Color(178, 190, 210, 255);
const COLOR_REVEALED = new Color(233, 235, 238, 255);
const COLOR_MINE_HIT = new Color(226, 90, 90, 255);
const COLOR_MINE_OTHER = new Color(235, 205, 120, 255);
const COLOR_WRONG_FLAG = new Color(235, 150, 90, 255);

const NUMBER_COLORS: (Color | null)[] = [
    null,
    new Color(30, 90, 220, 255),
    new Color(40, 130, 60, 255),
    new Color(210, 40, 40, 255),
    new Color(20, 30, 130, 255),
    new Color(120, 30, 30, 255),
    new Color(20, 130, 130, 255),
    new Color(20, 20, 20, 255),
    new Color(90, 90, 90, 255),
];

@ccclass('MineCell')
export class MineCell extends Component {
    public row = 0;
    public col = 0;
    public isMine = false;
    public adjacent = 0;
    public revealed = false;
    public flagged = false;

    private _manager: Mine | null = null;
    private _gfx: Graphics | null = null;
    private _label: Label | null = null;
    private _button: Button | null = null;
    private _size = 0;

    public setup(manager: Mine, row: number, col: number, size: number): void {
        this._manager = manager;
        this.row = row;
        this.col = col;
        this.isMine = false;
        this.adjacent = 0;
        this.revealed = false;
        this.flagged = false;
        this._size = size;

        let uiT = this.node.getComponent(UITransform);
        if (!uiT) {
            uiT = this.node.addComponent(UITransform);
        }
        uiT.setContentSize(size, size);

        if (!this._gfx) {
            this._gfx = this.node.addComponent(Graphics);
        }

        if (!this._label) {
            const labelNode = new Node('Label');
            labelNode.parent = this.node;
            const labelUiT = labelNode.addComponent(UITransform);
            labelUiT.setContentSize(size, size);
            const label = labelNode.addComponent(Label);
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            label.isBold = true;
            label.string = '';
            this._label = label;
        }
        this._label.fontSize = Math.max(12, Math.floor(size * 0.5));
        this._label.lineHeight = this._label.fontSize;

        if (!this._button) {
            const btn = this.node.addComponent(Button);
            btn.target = this.node;
            btn.transition = Button.Transition.NONE;
            this._button = btn;
        }
        this.node.setScale(1, 1, 1);

        this.node.off(Button.EventType.CLICK, this._onClick, this);
        this.node.on(Button.EventType.CLICK, this._onClick, this);
        this.node.off(Node.EventType.MOUSE_DOWN, this._onMouseDown, this);
        this.node.on(Node.EventType.MOUSE_DOWN, this._onMouseDown, this);

        this.refresh();
    }

    private _onClick(): void {
        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(0.06, { scale: new Vec3(0.72, 0.72, 1) }, { easing: 'quadOut' })
            .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
        this._manager?.onCellLeftClick(this);
    }

    private _onMouseDown(e: EventMouse): void {
        if (!this._manager) {
            return;
        }
        if (e.getButton() === EventMouse.BUTTON_RIGHT) {
            this._manager.onCellRightClick(this);
        }
    }

    private _paint(color: Color): void {
        if (!this._gfx) {
            return;
        }
        this._gfx.clear();
        this._gfx.fillColor = color;
        this._gfx.rect(-this._size / 2, -this._size / 2, this._size, this._size);
        this._gfx.fill();
    }

    public refresh(): void {
        if (!this._gfx || !this._label) {
            return;
        }
        if (this._button) {
            this._button.interactable = !this.revealed;
        }
        if (!this.revealed) {
            this._paint(COLOR_COVERED);
            this._label.string = this.flagged ? 'F' : '';
            this._label.color = Color.RED;
            return;
        }

        if (this.isMine) {
            this._paint(COLOR_MINE_HIT);
            this._label.string = '*';
            this._label.color = Color.BLACK;
            return;
        }

        this._paint(COLOR_REVEALED);
        if (this.adjacent > 0) {
            this._label.string = String(this.adjacent);
            this._label.color = NUMBER_COLORS[this.adjacent] ?? Color.BLACK;
        } else {
            this._label.string = '';
        }
    }

    /** Used only when the game ends, to reveal every mine and mark incorrect flags. */
    public showEndState(hitMine: MineCell): void {
        if (!this._gfx || !this._label) {
            return;
        }
        if (this._button) {
            this._button.interactable = false;
        }
        if (this.isMine && !this.flagged) {
            this._paint(this === hitMine ? COLOR_MINE_HIT : COLOR_MINE_OTHER);
            this._label.string = '*';
            this._label.color = Color.BLACK;
        } else if (!this.isMine && this.flagged) {
            this._paint(COLOR_WRONG_FLAG);
            this._label.string = 'F';
            this._label.color = Color.BLACK;
        }
    }
}
