import { _decorator, Component, Node, Graphics, Label, Color, UITransform, Enum, Button } from 'cc';
const { ccclass, property } = _decorator;

export enum Suit {
    Spade = 0,
    Heart = 1,
    Diamond = 2,
    Club = 3,
}
Enum(Suit);

export const SUIT_IS_RED: Record<Suit, boolean> = {
    [Suit.Spade]: false,
    [Suit.Heart]: true,
    [Suit.Diamond]: true,
    [Suit.Club]: false,
};

const COLOR_WHITE = new Color(255, 255, 255, 255);
const COLOR_BORDER = new Color(205, 205, 205, 255);
const COLOR_SELECTED = new Color(70, 150, 230, 255);
const COLOR_RED = new Color(200, 30, 40, 255);
const COLOR_BLACK = new Color(25, 25, 25, 255);

const BACK_BASE = new Color(160, 20, 32, 255);
const BACK_TRIM = new Color(230, 210, 150, 255);
const BACK_PATTERN = new Color(200, 60, 72, 255);

@ccclass('PokerCard')
export class PokerCard extends Component {
    @property({ type: Suit })
    public suit: Suit = Suit.Spade;

    @property
    public rank = 'A';

    @property
    public width = 140;

    @property
    public height = 196;

    @property
    public faceUp = true;

    /** Set by the owning game to react to clicks (e.g. select this card for a move). */
    public onCardClick: ((card: PokerCard) => void) | null = null;

    private _faceNode: Node | null = null;
    private _backNode: Node | null = null;
    private _suitGfx: Graphics | null = null;
    private _rankTL: Label | null = null;
    private _rankBR: Label | null = null;
    private _button: Button | null = null;
    private _selected = false;

    protected onLoad(): void {
        this._build();
        this.refresh();
    }

    /** Reconfigures this card instance (e.g. when reusing one prefab instance to represent different cards). */
    public setCard(rank: string, suit: Suit): void {
        this.rank = rank;
        this.suit = suit;
        this.refresh();
    }

    public setFaceUp(faceUp: boolean): void {
        this.faceUp = faceUp;
        this.refresh();
    }

    public setSelected(selected: boolean): void {
        this._selected = selected;
        this._drawFaceBackground();
    }

    /** Lets a consuming game reuse this one prefab at whatever card size its layout needs. */
    public resize(width: number, height: number): void {
        this.width = width;
        this.height = height;

        this.node.getComponent(UITransform)?.setContentSize(width, height);
        this._faceNode?.getComponent(UITransform)?.setContentSize(width, height);
        this._backNode?.getComponent(UITransform)?.setContentSize(width, height);
        this._suitGfx?.node.getComponent(UITransform)?.setContentSize(width, height);

        const cornerFont = Math.floor(height * 0.12);
        const marginX = width * 0.14;
        const marginY = height * 0.09;
        if (this._rankTL) {
            this._rankTL.node.setPosition(-width / 2 + marginX, height / 2 - marginY, 0);
            this._rankTL.node.getComponent(UITransform)?.setContentSize(cornerFont * 2, cornerFont * 1.4);
            this._rankTL.fontSize = cornerFont;
            this._rankTL.lineHeight = cornerFont;
        }
        if (this._rankBR) {
            this._rankBR.node.setPosition(width / 2 - marginX, -height / 2 + marginY, 0);
            this._rankBR.node.getComponent(UITransform)?.setContentSize(cornerFont * 2, cornerFont * 1.4);
            this._rankBR.fontSize = cornerFont;
            this._rankBR.lineHeight = cornerFont;
        }

        this._drawFaceBackground();
        const backGfx = this._backNode?.getComponent(Graphics);
        if (backGfx) {
            this._drawBack(backGfx);
        }
        this.refresh();
    }

    public refresh(): void {
        const color = SUIT_IS_RED[this.suit] ? COLOR_RED : COLOR_BLACK;
        if (this._rankTL) {
            this._rankTL.string = this.rank;
            this._rankTL.color = color;
        }
        if (this._rankBR) {
            this._rankBR.string = this.rank;
            this._rankBR.color = color;
        }
        this._drawSuit(color);

        if (this._faceNode) {
            this._faceNode.active = this.faceUp;
        }
        if (this._backNode) {
            this._backNode.active = !this.faceUp;
        }
    }

    private _build(): void {
        let uiT = this.node.getComponent(UITransform);
        if (!uiT) {
            uiT = this.node.addComponent(UITransform);
        }
        uiT.setContentSize(this.width, this.height);

        this._faceNode = new Node('Face');
        this._faceNode.parent = this.node;
        this._faceNode.addComponent(UITransform).setContentSize(this.width, this.height);
        this._faceNode.addComponent(Graphics);
        this._drawFaceBackground();

        const suitNode = new Node('Suit');
        suitNode.parent = this._faceNode;
        suitNode.addComponent(UITransform).setContentSize(this.width, this.height);
        this._suitGfx = suitNode.addComponent(Graphics);

        const cornerFont = Math.floor(this.height * 0.12);
        const marginX = this.width * 0.14;
        const marginY = this.height * 0.09;

        const tlNode = new Node('RankTL');
        tlNode.parent = this._faceNode;
        tlNode.setPosition(-this.width / 2 + marginX, this.height / 2 - marginY, 0);
        tlNode.addComponent(UITransform).setContentSize(cornerFont * 2, cornerFont * 1.4);
        this._rankTL = tlNode.addComponent(Label);
        this._rankTL.fontSize = cornerFont;
        this._rankTL.lineHeight = cornerFont;
        this._rankTL.isBold = true;
        this._rankTL.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._rankTL.verticalAlign = Label.VerticalAlign.CENTER;

        const brNode = new Node('RankBR');
        brNode.parent = this._faceNode;
        brNode.setPosition(this.width / 2 - marginX, -this.height / 2 + marginY, 0);
        brNode.angle = 180;
        brNode.addComponent(UITransform).setContentSize(cornerFont * 2, cornerFont * 1.4);
        this._rankBR = brNode.addComponent(Label);
        this._rankBR.fontSize = cornerFont;
        this._rankBR.lineHeight = cornerFont;
        this._rankBR.isBold = true;
        this._rankBR.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._rankBR.verticalAlign = Label.VerticalAlign.CENTER;

        this._backNode = new Node('Back');
        this._backNode.parent = this.node;
        this._backNode.addComponent(UITransform).setContentSize(this.width, this.height);
        const backGfx = this._backNode.addComponent(Graphics);
        this._drawBack(backGfx);

        this._button = this.node.addComponent(Button);
        this._button.target = this.node;
        this._button.transition = Button.Transition.NONE;
        this.node.on(Button.EventType.CLICK, () => this.onCardClick?.(this));
    }

    private _drawFaceBackground(): void {
        const g = this._faceNode!.getComponent(Graphics)!;
        g.clear();
        g.fillColor = COLOR_WHITE;
        g.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 10);
        g.fill();
        g.lineWidth = this._selected ? 4 : 2;
        g.strokeColor = this._selected ? COLOR_SELECTED : COLOR_BORDER;
        g.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 10);
        g.stroke();
    }

    /**
     * Classic card-back look: solid color card + gold double border frame +
     * a repeating diamond lattice, all hand-drawn with Graphics (rounded
     * rects, closed diamond polygons via moveTo/lineTo/close+fill - stroking
     * open paths doesn't render reliably, so every shape here is closed
     * before fill()/stroke()).
     */
    private _drawBack(g: Graphics): void {
        const w = this.width;
        const h = this.height;
        g.clear();

        g.fillColor = BACK_BASE;
        g.roundRect(-w / 2, -h / 2, w, h, 10);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = BACK_TRIM;
        g.roundRect(-w / 2, -h / 2, w, h, 10);
        g.stroke();

        const inset = Math.min(w, h) * 0.09;
        const innerW = w - inset * 2;
        const innerH = h - inset * 2;
        g.lineWidth = 2;
        g.strokeColor = BACK_TRIM;
        g.roundRect(-innerW / 2, -innerH / 2, innerW, innerH, 6);
        g.stroke();

        const cols = 5;
        const rows = 7;
        const cellW = innerW / cols;
        const cellH = innerH / rows;
        const dw = cellW * 0.4;
        const dh = cellH * 0.4;
        g.fillColor = BACK_PATTERN;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = -innerW / 2 + cellW * (c + 0.5);
                const cy = -innerH / 2 + cellH * (r + 0.5);
                g.moveTo(cx, cy + dh);
                g.lineTo(cx + dw, cy);
                g.lineTo(cx, cy - dh);
                g.lineTo(cx - dw, cy);
                g.close();
            }
        }
        g.fill();
    }

    /**
     * Traces a smooth heart silhouette (point down) using the classic
     * parametric heart curve, sampled into many short line segments so the
     * lobes and point blend into one continuous curve instead of two circles
     * stitched to a straight-edged triangle (which reads as a visible seam).
     * `flip` inverts it point-up, which is exactly a spade's outline.
     */
    private _tracePointyLobe(g: Graphics, size: number, flip: boolean): void {
        const scale = size / 30;
        const steps = 48;
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * Math.PI * 2;
            const x = 16 * Math.pow(Math.sin(t), 3) * scale;
            let y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * scale;
            if (flip) {
                y = -y;
            }
            if (i === 0) {
                g.moveTo(x, y);
            } else {
                g.lineTo(x, y);
            }
        }
        g.close();
    }

    /** Suits are hand-drawn with Graphics primitives (circles + closed polygons), not text glyphs or images. */
    private _drawSuit(color: Color): void {
        if (!this._suitGfx) {
            return;
        }
        const g = this._suitGfx;
        const size = Math.min(this.width, this.height) * 0.34;
        g.clear();
        g.fillColor = color;

        switch (this.suit) {
        case Suit.Diamond:
            g.moveTo(0, size * 0.65);
            g.lineTo(size * 0.45, 0);
            g.lineTo(0, -size * 0.65);
            g.lineTo(-size * 0.45, 0);
            g.close();
            g.fill();
            break;
        case Suit.Club: {
            const r = size * 0.28;
            g.circle(0, size * 0.3, r);
            g.circle(-size * 0.26, -size * 0.05, r);
            g.circle(size * 0.26, -size * 0.05, r);
            g.fill();
            g.rect(-size * 0.08, -size * 0.6, size * 0.16, size * 0.4);
            g.fill();
            break;
        }
        case Suit.Heart:
            this._tracePointyLobe(g, size, false);
            g.fill();
            break;
        case Suit.Spade:
            this._tracePointyLobe(g, size, true);
            g.fill();
            g.rect(-size * 0.06, -size * 0.62, size * 0.12, size * 0.32);
            g.fill();
            break;
        default:
            break;
        }
    }
}
