import {
    _decorator, Component, Node, Prefab, SpriteFrame, Label, Color, UITransform,
    Graphics, instantiate, Vec3, EventTouch, view,
} from 'cc';
import { PokerCard, Suit, SUIT_IS_RED } from './PokerCard';
import { Leaderboard, ScoreEntry } from './Leaderboard';
import { createFlatRect, createOverlayBackdrop, createPanel, createLabel, createWrappedLabel, createButton, ButtonSprites } from './UiKit';
const { ccclass, property } = _decorator;

type Variant = 'klondike' | 'freecell';

interface GameMode {
    key: string;
    label: string;
    variant: Variant;
    drawCount?: number;
    freeCellCount: number;
}

const MODES: GameMode[] = [
    { key: 'draw1', label: '單張抽牌', variant: 'klondike', drawCount: 1, freeCellCount: 1 },
    { key: 'draw3', label: '三張抽牌', variant: 'klondike', drawCount: 3, freeCellCount: 1 },
    { key: 'freecell', label: '空當接龍', variant: 'freecell', freeCellCount: 5 },
];

const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const SUIT_SYMBOLS: Record<Suit, string> = {
    [Suit.Spade]: '♠',
    [Suit.Heart]: '♥',
    [Suit.Diamond]: '♦',
    [Suit.Club]: '♣',
};

const RULES_TEXT = '【接龍】拖曳翻開的牌到其他行或收集堆，同一行中只能疊放顏色交替、點數遞減的牌，空的一行只能放國王(K)。畫面左上角有 1 個暫存格，可以暫放任意一張牌。點擊抽牌堆可以抽牌。\n\n'
    + '【空當接龍】開局所有牌都是翻開的，5 個空當格可以暫放任意一張牌，空的一行可以放任何牌。一次能搬動的疊牌張數，取決於目前空的空當格與空行數量。\n\n'
    + '兩種玩法都要把收集堆依花色從 A 依序疊到 K 即可獲勝。';

type Destination =
    | { type: 'tableau'; col: number }
    | { type: 'foundation'; suit: Suit }
    | { type: 'freecell'; index: number };

type Location =
    | { pile: 'tableau'; col: number }
    | { pile: 'foundation'; suit: Suit }
    | { pile: 'freecell'; index: number }
    | { pile: 'waste' }
    | { pile: 'stock' };

function leaderboardKey(modeKey: string): string {
    return `solitaire_${modeKey}`;
}

interface Snapshot {
    tableau: number[][];
    foundations: number[][];
    stock: number[];
    waste: number[];
    freeCells: (number | null)[];
    faceUpSet: number[];
    moves: number;
}

const MAX_HISTORY = 50;

@ccclass('Solitaire')
export class Solitaire extends Component {
    @property(Prefab)
    public cardPrefab: Prefab | null = null;

    @property(SpriteFrame)
    public sfBtnNormal: SpriteFrame | null = null;

    @property(SpriteFrame)
    public sfBtnPressed: SpriteFrame | null = null;

    @property(SpriteFrame)
    public sfBtnDisabled: SpriteFrame | null = null;

    /** Set by the launcher after instantiating this game; shows a "back to game menu" button when present. */
    public onExitToLauncher: (() => void) | null = null;

    private _designW = 1920;
    private _designH = 1080;
    private _cardW = 90;
    private _cardH = 126;
    private _row1Y = 0;
    private _row2Y = 0;
    private _tableauCols = 7;
    private _freeCellCount = 1;
    private readonly _marginX = 24;
    private readonly _colGap = 12;

    private _topBar: Node | null = null;
    private _timeLabel: Label | null = null;
    private _movesLabel: Label | null = null;
    private _menuOverlay: Node | null = null;
    private _rulesOverlay: Node | null = null;
    private _resultOverlay: Node | null = null;
    private _resultTitleLabel: Label | null = null;
    private _resultTimeLabel: Label | null = null;
    private _resultBoardLabel: Label | null = null;

    private _slotsNode: Node | null = null;
    private _cardLayer: Node | null = null;
    private _cardData: Map<number, { rank: number; suit: Suit }> = new Map();
    private _cardNodes: Map<number, Node> = new Map();

    private _tableau: number[][] = [];
    private _foundations: number[][] = [];
    private _stock: number[] = [];
    private _waste: number[] = [];
    private _freeCells: (number | null)[] = [null, null, null, null];
    private _faceUpSet: Set<number> = new Set();

    private _dragIds: number[] = [];
    private _dragSource: Location | null = null;
    private _dragOffsets: { x: number; y: number }[] = [];

    private _mode: GameMode | null = null;
    private _moves = 0;
    private _elapsed = 0;
    private _gameActive = false;

    private _deadEndLabel: Label | null = null;
    private _history: Snapshot[] = [];

    private get _btnSprites(): ButtonSprites {
        return { normal: this.sfBtnNormal, pressed: this.sfBtnPressed, disabled: this.sfBtnDisabled };
    }

    private get _isFreeCell(): boolean {
        return this._mode?.variant === 'freecell';
    }

    protected onLoad(): void {
        const visible = view.getVisibleSize();
        this._designW = visible.width;
        this._designH = visible.height;
        this.getComponent(UITransform)?.setContentSize(this._designW, this._designH);

        this._computeLayout(7);

        createFlatRect(this.node, 'Background', this._designW, this._designH, new Color(20, 100, 60, 255));

        this._buildTopBar();
        this._buildMenuOverlay();
        this._buildRulesOverlay();
        this._buildResultOverlay();

        this._showMenu();
    }

    protected update(dt: number): void {
        if (!this._gameActive) {
            return;
        }
        this._elapsed += dt;
        this._updateTimeLabel();
    }

    // ---------------------------------------------------------------------
    // Dealing / setup
    // ---------------------------------------------------------------------

    private _computeLayout(cols: number): void {
        this._tableauCols = cols;
        this._cardW = Math.floor((this._designW - this._marginX * 2 - this._colGap * (cols - 1)) / cols);
        this._cardW = Math.max(50, Math.min(120, this._cardW));
        this._cardH = Math.floor(this._cardW * 1.4);
        this._row1Y = this._designH / 2 - 90 - this._cardH / 2;
        this._row2Y = this._row1Y - this._cardH - 30;
    }

    private _startGame(mode: GameMode): void {
        this._mode = mode;
        this._moves = 0;
        this._elapsed = 0;
        this._gameActive = true;
        this._freeCellCount = mode.freeCellCount;
        this._computeLayout(mode.variant === 'freecell' ? 8 : 7);

        this._buildDeckData();
        this._createCardNodes();
        this._deal();
        this._buildSlots();

        this._updateTimeLabel();
        this._updateMovesLabel();

        this._menuOverlay!.active = false;
        this._resultOverlay!.active = false;
        this._topBar!.active = true;
        this._slotsNode!.active = true;
        this._cardLayer!.active = true;

        this._renderAll();
        this._updateDeadEndLabel();
    }

    private _buildDeckData(): void {
        this._cardData.clear();
        for (let s = 0; s < 4; s++) {
            for (let r = 1; r <= 13; r++) {
                this._cardData.set(s * 13 + (r - 1), { rank: r, suit: s as Suit });
            }
        }
    }

    private _createCardNodes(): void {
        if (this._cardLayer) {
            this._cardLayer.destroy();
        }
        this._cardLayer = new Node('Cards');
        this._cardLayer.parent = this.node;
        this._cardLayer.addComponent(UITransform).setContentSize(this._designW, this._designH);
        this._cardNodes.clear();

        for (let id = 0; id < 52; id++) {
            const data = this._cardData.get(id)!;
            const node = instantiate(this.cardPrefab!);
            node.parent = this._cardLayer;
            const card = node.getComponent(PokerCard)!;
            card.resize(this._cardW, this._cardH);
            card.setCard(RANK_LABELS[data.rank], data.suit);
            card.onCardClick = () => this._onCardClicked(id);
            node.on(Node.EventType.TOUCH_START, (e: EventTouch) => this._onCardTouchStart(id, e));
            node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => this._onCardTouchMove(e));
            node.on(Node.EventType.TOUCH_END, (e: EventTouch) => this._onCardTouchEnd(e));
            node.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => this._onCardTouchEnd(e));
            this._cardNodes.set(id, node);
        }
    }

    private _deal(): void {
        const deck: number[] = [];
        for (let i = 0; i < 52; i++) {
            deck.push(i);
        }
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        this._tableau = Array.from({ length: this._tableauCols }, () => []);
        this._foundations = [[], [], [], []];
        this._waste = [];
        this._stock = [];
        this._freeCells = new Array(this._freeCellCount).fill(null);
        this._faceUpSet = new Set();

        let idx = 0;
        if (this._isFreeCell) {
            for (let c = 0; c < 8; c++) {
                const count = c < 4 ? 7 : 6;
                for (let r = 0; r < count; r++) {
                    const id = deck[idx++];
                    this._tableau[c].push(id);
                    this._faceUpSet.add(id);
                }
            }
        } else {
            for (let c = 0; c < 7; c++) {
                for (let r = 0; r <= c; r++) {
                    const id = deck[idx++];
                    this._tableau[c].push(id);
                    if (r === c) {
                        this._faceUpSet.add(id);
                    }
                }
            }
            this._stock = deck.slice(idx);
        }

        this._dragIds = [];
        this._dragSource = null;
        this._history = [];
    }

    // ---------------------------------------------------------------------
    // Undo / dead-end detection
    // ---------------------------------------------------------------------

    private _pushHistory(): void {
        this._history.push({
            tableau: this._tableau.map((col) => col.slice()),
            foundations: this._foundations.map((pile) => pile.slice()),
            stock: this._stock.slice(),
            waste: this._waste.slice(),
            freeCells: this._freeCells.slice(),
            faceUpSet: Array.from(this._faceUpSet),
            moves: this._moves,
        });
        if (this._history.length > MAX_HISTORY) {
            this._history.shift();
        }
    }

    private _undo(): void {
        if (!this._gameActive || this._history.length === 0) {
            return;
        }
        const snap = this._history.pop()!;
        this._tableau = snap.tableau;
        this._foundations = snap.foundations;
        this._stock = snap.stock;
        this._waste = snap.waste;
        this._freeCells = snap.freeCells;
        this._faceUpSet = new Set(snap.faceUpSet);
        this._moves = snap.moves;
        this._dragIds = [];
        this._dragSource = null;
        this._updateMovesLabel();
        this._renderAll();
        this._updateDeadEndLabel();
    }

    /** Non-blocking heuristic: checks column/waste/free-cell tops against foundations & tableaus, plus stock/waste availability and spare free cells. */
    private _hasAnyMove(): boolean {
        if (!this._isFreeCell && (this._stock.length > 0 || this._waste.length > 0)) {
            return true;
        }
        if (this._freeCells.some((c) => c === null)) {
            return true;
        }

        const movableIds: number[] = [];
        for (let c = 0; c < this._tableauCols; c++) {
            const col = this._tableau[c];
            if (col.length > 0 && this._faceUpSet.has(col[col.length - 1])) {
                movableIds.push(col[col.length - 1]);
            }
        }
        if (!this._isFreeCell && this._waste.length > 0) {
            movableIds.push(this._waste[this._waste.length - 1]);
        }
        this._freeCells.forEach((id) => {
            if (id !== null) {
                movableIds.push(id);
            }
        });

        for (const id of movableIds) {
            for (let s = 0; s < 4; s++) {
                if (this._canPlaceOnFoundation(id, s as Suit)) {
                    return true;
                }
            }
            for (let c = 0; c < this._tableauCols; c++) {
                if (this._canPlaceOnTableau(id, c)) {
                    return true;
                }
            }
        }
        return false;
    }

    private _updateDeadEndLabel(): void {
        if (!this._deadEndLabel) {
            return;
        }
        this._deadEndLabel.node.active = this._gameActive && !this._hasAnyMove();
    }

    // ---------------------------------------------------------------------
    // Layout helpers
    // ---------------------------------------------------------------------

    /** Centres a row of `count` evenly-spaced slots around x=0 instead of anchoring to the left edge. */
    private _slotXForCount(index: number, count: number): number {
        const step = this._cardW + this._colGap;
        const totalSpan = (count - 1) * step;
        return -totalSpan / 2 + index * step;
    }

    private _slotX(index: number): number {
        return this._slotXForCount(index, this._tableauCols);
    }

    /**
     * How many slots the free-cell/foundation row spans. For Klondike this always equals
     * _tableauCols (free cell + foundations + waste + stock fill it exactly), so it lines up
     * with the tableau columns below. FreeCell has no waste/stock, so if its free-cell count
     * ever doesn't match its 8 tableau columns, the top row centres independently instead of
     * trying to force an alignment that no longer fits.
     */
    private _topRowCount(): number {
        return this._isFreeCell ? this._freeCellCount + 4 : this._tableauCols;
    }

    private _foundationX(suitIndex: number): number {
        return this._slotXForCount(this._freeCellCount + suitIndex, this._topRowCount());
    }

    private _freeCellX(index: number): number {
        return this._slotXForCount(index, this._topRowCount());
    }

    private _stockPos(): { x: number; y: number } {
        return { x: this._slotX(this._tableauCols - 1), y: this._row1Y };
    }

    private _wastePos(fanIndex: number, fanCount: number): { x: number; y: number } {
        const baseX = this._slotX(this._tableauCols - 2);
        const spread = this._cardW * 0.28;
        return { x: baseX + (fanIndex - (fanCount - 1)) * spread, y: this._row1Y };
    }

    private _tableauX(col: number): number {
        return this._slotX(col);
    }

    private _tableauPos(col: number, indexInColumn: number): { x: number; y: number } {
        const fanOffset = this._cardH * 0.24;
        return { x: this._tableauX(col), y: this._row2Y - indexInColumn * fanOffset };
    }

    private _buildSlots(): void {
        if (this._slotsNode) {
            this._slotsNode.destroy();
        }
        this._slotsNode = new Node('Slots');
        this._slotsNode.parent = this.node;
        // Must render above the opaque Background rect but below the cards, so insert it
        // right where the card layer currently sits (pushing the card layer one slot later)
        // rather than forcing index 0, which used to land it *behind* the background - invisible.
        this._slotsNode.setSiblingIndex(this._cardLayer!.getSiblingIndex());
        this._slotsNode.addComponent(UITransform).setContentSize(this._designW, this._designH);

        const g = this._slotsNode.addComponent(Graphics);

        // Free cells get a warmer, distinct outline so they read as the "temporary parking"
        // slots, separate from the fixed suit targets / tableau columns.
        if (this._freeCellCount > 0) {
            g.lineWidth = 3;
            g.strokeColor = new Color(235, 195, 90, 220);
            for (let i = 0; i < this._freeCellCount; i++) {
                const x = this._freeCellX(i);
                g.roundRect(x - this._cardW / 2, this._row1Y - this._cardH / 2, this._cardW, this._cardH, 8);
            }
            g.stroke();
        }

        g.lineWidth = 2;
        g.strokeColor = new Color(230, 235, 230, 180);
        for (let s = 0; s < 4; s++) {
            const x = this._foundationX(s);
            g.roundRect(x - this._cardW / 2, this._row1Y - this._cardH / 2, this._cardW, this._cardH, 8);
        }
        if (!this._isFreeCell) {
            const stockPos = this._stockPos();
            g.roundRect(stockPos.x - this._cardW / 2, stockPos.y - this._cardH / 2, this._cardW, this._cardH, 8);
        }
        for (let c = 0; c < this._tableauCols; c++) {
            const x = this._tableauX(c);
            g.roundRect(x - this._cardW / 2, this._row2Y - this._cardH / 2, this._cardW, this._cardH, 8);
        }
        g.stroke();

        // Faint suit hint in each foundation slot - otherwise an empty foundation gives no clue
        // which suit belongs there until a card has already been placed in it.
        for (let s = 0; s < 4; s++) {
            const x = this._foundationX(s);
            const color = SUIT_IS_RED[s as Suit] ? new Color(210, 130, 130, 160) : new Color(150, 150, 150, 160);
            createLabel(this._slotsNode, SUIT_SYMBOLS[s as Suit], x, this._row1Y, Math.floor(this._cardH * 0.4), color);
        }
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    private _renderAll(): void {
        let order = 0;
        const place = (id: number, x: number, y: number, faceUp: boolean): void => {
            const node = this._cardNodes.get(id)!;
            node.active = true;
            node.setPosition(x, y, 0);
            node.setSiblingIndex(order++);
            const card = node.getComponent(PokerCard)!;
            if (card.faceUp !== faceUp) {
                card.setFaceUp(faceUp);
            }
        };

        for (let s = 0; s < 4; s++) {
            this._foundations[s].forEach((id) => place(id, this._foundationX(s), this._row1Y, true));
        }

        this._freeCells.forEach((id, i) => {
            if (id !== null) {
                place(id, this._freeCellX(i), this._row1Y, true);
            }
        });

        if (!this._isFreeCell) {
            this._stock.forEach((id) => place(id, this._stockPos().x, this._stockPos().y, false));

            const shown = this._waste.slice(-3);
            shown.forEach((id, i) => {
                const pos = this._wastePos(i, shown.length);
                place(id, pos.x, pos.y, true);
            });
            this._waste.slice(0, -3).forEach((id) => {
                this._cardNodes.get(id)!.active = false;
            });
        }

        for (let c = 0; c < this._tableauCols; c++) {
            this._tableau[c].forEach((id, i) => {
                const pos = this._tableauPos(c, i);
                place(id, pos.x, pos.y, this._faceUpSet.has(id));
            });
        }

        this._cardNodes.forEach((node, id) => {
            const card = node.getComponent(PokerCard)!;
            card.setSelected(this._dragIds.includes(id));
        });
    }

    // ---------------------------------------------------------------------
    // Input
    // ---------------------------------------------------------------------

    private _locate(id: number): Location {
        for (let c = 0; c < this._tableauCols; c++) {
            if (this._tableau[c].includes(id)) {
                return { pile: 'tableau', col: c };
            }
        }
        for (let s = 0; s < 4; s++) {
            if (this._foundations[s].includes(id)) {
                return { pile: 'foundation', suit: s as Suit };
            }
        }
        for (let i = 0; i < this._freeCells.length; i++) {
            if (this._freeCells[i] === id) {
                return { pile: 'freecell', index: i };
            }
        }
        if (this._waste.includes(id)) {
            return { pile: 'waste' };
        }
        return { pile: 'stock' };
    }

    /** Only the stock pile still reacts to a plain click/tap - everything else is drag-driven. */
    private _onCardClicked(id: number): void {
        if (!this._gameActive) {
            return;
        }
        if (this._locate(id).pile === 'stock') {
            this._drawFromStock();
        }
    }

    private _eventToLocal(event: EventTouch): { x: number; y: number } {
        const uiLoc = event.getUILocation();
        const local = this._cardLayer!.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(uiLoc.x, uiLoc.y, 0));
        return { x: local.x, y: local.y };
    }

    private _hitTestDrop(x: number, y: number): Destination | null {
        const halfStep = (this._cardW + this._colGap) / 2;
        if (this._freeCellCount > 0) {
            for (let i = 0; i < this._freeCellCount; i++) {
                const cx = this._freeCellX(i);
                if (Math.abs(x - cx) <= halfStep && Math.abs(y - this._row1Y) <= this._cardH / 2) {
                    return { type: 'freecell', index: i };
                }
            }
        }
        for (let s = 0; s < 4; s++) {
            const fx = this._foundationX(s);
            if (Math.abs(x - fx) <= halfStep && Math.abs(y - this._row1Y) <= this._cardH / 2) {
                return { type: 'foundation', suit: s as Suit };
            }
        }
        for (let c = 0; c < this._tableauCols; c++) {
            const tx = this._tableauX(c);
            if (Math.abs(x - tx) <= halfStep && y <= this._row2Y + this._cardH / 2) {
                return { type: 'tableau', col: c };
            }
        }
        return null;
    }

    /** Whether ids (bottom-to-top order) form a single valid alternating-color descending sequence. */
    private _isValidRun(ids: number[]): boolean {
        for (let i = 0; i < ids.length - 1; i++) {
            const lower = this._cardData.get(ids[i])!;
            const upper = this._cardData.get(ids[i + 1])!;
            if (SUIT_IS_RED[lower.suit] === SUIT_IS_RED[upper.suit] || lower.rank !== upper.rank + 1) {
                return false;
            }
        }
        return true;
    }

    private _onCardTouchStart(id: number, event: EventTouch): void {
        if (!this._gameActive || this._dragIds.length > 0) {
            return;
        }
        const loc = this._locate(id);
        let ids: number[];
        if (loc.pile === 'tableau') {
            if (!this._faceUpSet.has(id)) {
                return;
            }
            const col = this._tableau[loc.col];
            const candidate = col.slice(col.indexOf(id));
            if (!this._isValidRun(candidate)) {
                return;
            }
            ids = candidate;
            this._dragSource = { pile: 'tableau', col: loc.col };
        } else if (loc.pile === 'waste') {
            if (this._waste.length === 0 || this._waste[this._waste.length - 1] !== id) {
                return;
            }
            ids = [id];
            this._dragSource = { pile: 'waste' };
        } else if (loc.pile === 'freecell') {
            ids = [id];
            this._dragSource = { pile: 'freecell', index: loc.index };
        } else {
            return;
        }

        this._dragIds = ids;
        const localPos = this._eventToLocal(event);
        this._dragOffsets = ids.map((cid) => {
            const n = this._cardNodes.get(cid)!;
            return { x: n.position.x - localPos.x, y: n.position.y - localPos.y };
        });
        ids.forEach((cid) => {
            const n = this._cardNodes.get(cid)!;
            n.setSiblingIndex(this._cardLayer!.children.length - 1);
            n.getComponent(PokerCard)!.setSelected(true);
        });
    }

    private _onCardTouchMove(event: EventTouch): void {
        if (this._dragIds.length === 0) {
            return;
        }
        const localPos = this._eventToLocal(event);
        this._dragIds.forEach((cid, i) => {
            const n = this._cardNodes.get(cid)!;
            n.setPosition(localPos.x + this._dragOffsets[i].x, localPos.y + this._dragOffsets[i].y, 0);
        });
    }

    private _onCardTouchEnd(event: EventTouch): void {
        if (this._dragIds.length === 0) {
            return;
        }
        const localPos = this._eventToLocal(event);
        const ids = this._dragIds;
        const offsets = this._dragOffsets;
        const source = this._dragSource!;
        this._dragIds = [];
        this._dragSource = null;
        ids.forEach((cid) => this._cardNodes.get(cid)!.getComponent(PokerCard)!.setSelected(false));

        // Hit-test against the dragged card's actual on-screen position (pointer + its drag
        // offset), not the raw pointer - otherwise dropping feels wrong unless you happened to
        // grab the card exactly at its centre, since the card visually trails the pointer by
        // whatever offset it was first grabbed at.
        const dest = this._hitTestDrop(localPos.x + offsets[0].x, localPos.y + offsets[0].y);
        if (!dest || !this._tryMove(ids, source, dest)) {
            this._renderAll();
        }
    }

    private _canPlaceOnTableau(movingId: number, col: number): boolean {
        const moving = this._cardData.get(movingId)!;
        const pile = this._tableau[col];
        if (pile.length === 0) {
            return this._isFreeCell ? true : moving.rank === 13;
        }
        const dest = this._cardData.get(pile[pile.length - 1])!;
        return SUIT_IS_RED[moving.suit] !== SUIT_IS_RED[dest.suit] && moving.rank === dest.rank - 1;
    }

    private _canPlaceOnFoundation(movingId: number, suit: Suit): boolean {
        const moving = this._cardData.get(movingId)!;
        if (moving.suit !== suit) {
            return false;
        }
        const pile = this._foundations[suit];
        if (pile.length === 0) {
            return moving.rank === 1;
        }
        const top = this._cardData.get(pile[pile.length - 1])!;
        return moving.rank === top.rank + 1;
    }

    /** FreeCell "supermove" capacity: (empty free cells + 1) * 2^(usable empty columns). Klondike has no such limit. */
    private _maxMovableCount(destCol: number): number {
        if (!this._isFreeCell) {
            return Infinity;
        }
        const freeCount = this._freeCells.filter((c) => c === null).length;
        let emptyCols = this._tableau.filter((col) => col.length === 0).length;
        if (this._tableau[destCol].length === 0) {
            emptyCols -= 1;
        }
        return (freeCount + 1) * Math.pow(2, Math.max(0, emptyCols));
    }

    private _tryMove(ids: number[], source: Location, dest: Destination): boolean {
        const movingId = ids[0];
        let ok: boolean;
        if (dest.type === 'tableau') {
            ok = this._canPlaceOnTableau(movingId, dest.col) && ids.length <= this._maxMovableCount(dest.col);
        } else if (dest.type === 'foundation') {
            ok = ids.length === 1 && this._canPlaceOnFoundation(movingId, dest.suit);
        } else {
            ok = ids.length === 1 && this._freeCells[dest.index] === null;
        }
        if (!ok) {
            return false;
        }

        this._pushHistory();

        if (source.pile === 'tableau') {
            const col = this._tableau[source.col];
            col.splice(col.length - ids.length, ids.length);
            if (col.length > 0) {
                this._faceUpSet.add(col[col.length - 1]);
            }
        } else if (source.pile === 'waste') {
            this._waste.pop();
        } else if (source.pile === 'freecell') {
            this._freeCells[source.index] = null;
        }

        if (dest.type === 'tableau') {
            this._tableau[dest.col].push(...ids);
        } else if (dest.type === 'foundation') {
            this._foundations[dest.suit].push(...ids);
        } else {
            this._freeCells[dest.index] = ids[0];
        }
        ids.forEach((id) => this._faceUpSet.add(id));

        this._moves++;
        this._updateMovesLabel();
        this._renderAll();
        this._checkWin();
        this._updateDeadEndLabel();
        return true;
    }

    private _drawFromStock(): void {
        this._pushHistory();
        if (this._stock.length === 0) {
            this._waste.forEach((id) => this._faceUpSet.delete(id));
            this._stock = this._waste.slice().reverse();
            this._waste = [];
        } else {
            const count = Math.min(this._mode!.drawCount ?? 1, this._stock.length);
            for (let i = 0; i < count; i++) {
                const id = this._stock.pop()!;
                this._waste.push(id);
                this._faceUpSet.add(id);
            }
        }
        this._renderAll();
        this._updateDeadEndLabel();
    }

    private _checkWin(): void {
        const total = this._foundations.reduce((sum, pile) => sum + pile.length, 0);
        if (total === 52) {
            this._onWin();
        }
    }

    private _onWin(): void {
        this._gameActive = false;
        const timeSec = Math.floor(this._elapsed);
        const scores = Leaderboard.submit(leaderboardKey(this._mode!.key), timeSec, true);
        this._showResult(timeSec, scores);
    }

    // ---------------------------------------------------------------------
    // Top bar
    // ---------------------------------------------------------------------

    private _buildTopBar(): void {
        const bar = createFlatRect(this.node, 'TopBar', this._designW, 70, new Color(245, 245, 240, 255));
        bar.setPosition(0, this._designH / 2 - 35, 0);
        bar.active = false;
        this._topBar = bar;

        this._timeLabel = createLabel(bar, '時間：0秒', 0, 0, 22, new Color(20, 20, 20, 255));
        this._movesLabel = createLabel(bar, '步數：0', -160, 0, 22, new Color(20, 20, 20, 255));
        this._deadEndLabel = createLabel(bar, '目前沒有可行的步驟', 260, 0, 16, new Color(190, 60, 40, 255));
        this._deadEndLabel.node.active = false;

        createButton(bar, this._btnSprites, '選單', -this._designW / 2 + 60, 0, 90, 44, () => {
            this._showMenu();
        });
        createButton(bar, this._btnSprites, '回上一步', -this._designW / 2 + 175, 0, 120, 44, () => {
            this._undo();
        });
        createButton(bar, this._btnSprites, '重新開始', this._designW / 2 - 70, 0, 110, 44, () => {
            if (this._mode) {
                this._startGame(this._mode);
            }
        });
    }

    private _updateTimeLabel(): void {
        if (this._timeLabel) {
            this._timeLabel.string = `時間：${Math.floor(this._elapsed)}秒`;
        }
    }

    private _updateMovesLabel(): void {
        if (this._movesLabel) {
            this._movesLabel.string = `步數：${this._moves}`;
        }
    }

    // ---------------------------------------------------------------------
    // Menu overlay (mode select)
    // ---------------------------------------------------------------------

    private _buildMenuOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'MenuOverlay', this._designW, this._designH);
        this._menuOverlay = overlay;

        const panel = createPanel(overlay, 420, 440);
        createLabel(panel, '接龍 - 選擇玩法', 0, 170, 26, new Color(30, 30, 30, 255));

        const startY = 80;
        const stepY = 80;
        MODES.forEach((mode, index) => {
            const y = startY - index * stepY;
            createButton(panel, this._btnSprites, mode.label, -60, y, 220, 52, () => {
                this._startGame(mode);
            });
            const best = Leaderboard.getScores(leaderboardKey(mode.key))[0];
            const bestText = best ? `最佳：${best.value}秒` : '最佳：--';
            createLabel(panel, bestText, 140, y, 14, new Color(90, 90, 90, 255));
        });

        createButton(panel, this._btnSprites, '玩法說明', -110, -185, 190, 44, () => {
            this._showRules();
        });
        createButton(panel, this._btnSprites, '返回遊戲選單', 130, -185, 190, 44, () => {
            this.onExitToLauncher?.();
        });
    }

    private _showMenu(): void {
        this._gameActive = false;
        this._refreshMenuOverlay();
        this._menuOverlay!.active = true;
        this._rulesOverlay!.active = false;
        this._resultOverlay!.active = false;
        this._topBar!.active = false;
        if (this._slotsNode) {
            this._slotsNode.active = false;
        }
        if (this._cardLayer) {
            this._cardLayer.active = false;
        }
    }

    private _refreshMenuOverlay(): void {
        const panel = this._menuOverlay!.getChildByName('Panel')!;
        const bestLabels = panel.children.filter((n) => n.name === 'Label').slice(-MODES.length);
        bestLabels.forEach((node, index) => {
            const mode = MODES[index];
            const best = Leaderboard.getScores(leaderboardKey(mode.key))[0];
            const label = node.getComponent(Label)!;
            label.string = best ? `最佳：${best.value}秒` : '最佳：--';
        });
    }

    // ---------------------------------------------------------------------
    // Rules overlay
    // ---------------------------------------------------------------------

    private _buildRulesOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'RulesOverlay', this._designW, this._designH);
        this._rulesOverlay = overlay;
        overlay.active = false;

        const panel = createPanel(overlay, 560, 460);
        createLabel(panel, '玩法說明', 0, 195, 26, new Color(30, 30, 30, 255));
        createWrappedLabel(panel, RULES_TEXT, 0, 150, 480, 15, new Color(60, 60, 60, 255));

        createButton(panel, this._btnSprites, '關閉', 0, -195, 160, 48, () => {
            this._rulesOverlay!.active = false;
            this._menuOverlay!.active = true;
        });
    }

    private _showRules(): void {
        this._menuOverlay!.active = false;
        this._rulesOverlay!.active = true;
    }

    // ---------------------------------------------------------------------
    // Result overlay
    // ---------------------------------------------------------------------

    private _buildResultOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'ResultOverlay', this._designW, this._designH);
        this._resultOverlay = overlay;
        overlay.active = false;

        const panel = createPanel(overlay, 440, 420);
        this._resultTitleLabel = createLabel(panel, '獲勝！', 0, 160, 28, new Color(30, 130, 60, 255));
        this._resultTimeLabel = createLabel(panel, '時間：0秒', 0, 115, 20, new Color(60, 60, 60, 255));
        this._resultBoardLabel = createLabel(panel, '', 0, 20, 16, new Color(70, 70, 70, 255));

        createButton(panel, this._btnSprites, '再玩一次', -100, -160, 160, 48, () => {
            if (this._mode) {
                this._startGame(this._mode);
            }
        });
        createButton(panel, this._btnSprites, '選單', 100, -160, 160, 48, () => {
            this._showMenu();
        });
    }

    private _showResult(timeSec: number, scores: ScoreEntry[]): void {
        this._resultTitleLabel!.string = '獲勝！';
        this._resultTimeLabel!.string = `時間：${timeSec}秒　步數：${this._moves}`;

        if (scores.length === 0) {
            this._resultBoardLabel!.string = '此模式尚無紀錄';
        } else {
            const lines = scores.map((s, i) => `${i + 1}. ${s.value}秒　（${s.date}）`);
            this._resultBoardLabel!.string = `排行榜（${this._mode!.label}）\n${lines.join('\n')}`;
        }

        this._resultOverlay!.active = true;
    }
}
