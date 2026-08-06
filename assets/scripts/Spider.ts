import {
    _decorator, Component, Node, Prefab, SpriteFrame, Label, Color, UITransform,
    Graphics, instantiate, Vec3, EventTouch, view,
} from 'cc';
import { PokerCard, Suit } from './PokerCard';
import { Leaderboard, ScoreEntry } from './Leaderboard';
import { createFlatRect, createOverlayBackdrop, createPanel, createLabel, createWrappedLabel, createButton, ButtonSprites } from './UiKit';
const { ccclass, property } = _decorator;

const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const TOTAL_CARDS = 104;
const TABLEAU_COLS = 10;
const TOTAL_SETS = 8;

interface SpiderMode {
    key: string;
    label: string;
    suitCount: number;
}

const MODES: SpiderMode[] = [
    { key: 's1', label: '簡單（1 種花色）', suitCount: 1 },
    { key: 's2', label: '中等（2 種花色）', suitCount: 2 },
    { key: 's4', label: '困難（4 種花色）', suitCount: 4 },
];

const RULES_TEXT = '蜘蛛接龍使用兩副牌（共 104 張）。牌桌上有 10 行牌，每行只有最上面那張是翻開的。點擊抽牌堆會發一輪新牌（每行各補一張），但只有在沒有任何一行是空的時候才能抽牌。\n\n'
    + '同一行中，任何牌都能疊到點數大一號的牌上面，不限花色；但要一次搬動一整疊牌，必須是同花色、點數依序遞減的連續牌組才行——單張牌搬動則沒有花色限制。空的一行可以放任何牌。\n\n'
    + '只要湊出同一花色、從 K 到 A 依序疊好的完整一疊（13 張），就會自動被收走。收滿 8 疊（清空所有牌）即獲勝。\n\n'
    + '可以選擇難度：只用 1 種花色最簡單，2 種花色中等，4 種花色（等同兩副完整撲克牌混合）最難。';

function leaderboardKey(modeKey: string): string {
    return `spider_${modeKey}`;
}

@ccclass('Spider')
export class Spider extends Component {
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
    private readonly _marginX = 24;
    private readonly _colGap = 12;

    private _topBar: Node | null = null;
    private _timeLabel: Label | null = null;
    private _movesLabel: Label | null = null;
    private _progressLabel: Label | null = null;
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
    private _stock: number[] = [];
    private _faceUpSet: Set<number> = new Set();

    private _dragIds: number[] = [];
    private _dragSourceCol = -1;
    private _dragOffsets: { x: number; y: number }[] = [];

    private _mode: SpiderMode | null = null;
    private _moves = 0;
    private _elapsed = 0;
    private _completedSets = 0;
    private _gameActive = false;

    private get _btnSprites(): ButtonSprites {
        return { normal: this.sfBtnNormal, pressed: this.sfBtnPressed, disabled: this.sfBtnDisabled };
    }

    protected onLoad(): void {
        const visible = view.getVisibleSize();
        this._designW = visible.width;
        this._designH = visible.height;
        this.getComponent(UITransform)?.setContentSize(this._designW, this._designH);

        this._computeLayout();

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

    private _computeLayout(): void {
        this._cardW = Math.floor((this._designW - this._marginX * 2 - this._colGap * (TABLEAU_COLS - 1)) / TABLEAU_COLS);
        this._cardW = Math.max(50, Math.min(120, this._cardW));
        this._cardH = Math.floor(this._cardW * 1.4);
        this._row1Y = this._designH / 2 - 90 - this._cardH / 2;
        this._row2Y = this._row1Y - this._cardH - 30;
    }

    private _startGame(mode: SpiderMode): void {
        this._mode = mode;
        this._moves = 0;
        this._elapsed = 0;
        this._completedSets = 0;
        this._gameActive = true;

        this._buildDeckData(mode.suitCount);
        this._createCardNodes();
        this._dealCards();
        this._buildSlots();

        this._updateTimeLabel();
        this._updateMovesLabel();
        this._updateProgressLabel();

        this._menuOverlay!.active = false;
        this._resultOverlay!.active = false;
        this._topBar!.active = true;
        this._slotsNode!.active = true;
        this._cardLayer!.active = true;

        this._renderAll();
    }

    private _buildDeckData(suitCount: number): void {
        this._cardData.clear();
        const suits = suitCount === 1 ? [Suit.Spade]
            : suitCount === 2 ? [Suit.Spade, Suit.Heart]
                : [Suit.Spade, Suit.Heart, Suit.Diamond, Suit.Club];
        const copiesPerSuit = TOTAL_CARDS / (suits.length * 13);
        let id = 0;
        for (const suit of suits) {
            for (let copy = 0; copy < copiesPerSuit; copy++) {
                for (let r = 1; r <= 13; r++) {
                    this._cardData.set(id++, { rank: r, suit });
                }
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

        for (let id = 0; id < TOTAL_CARDS; id++) {
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

    private _dealCards(): void {
        const deck: number[] = [];
        for (let i = 0; i < TOTAL_CARDS; i++) {
            deck.push(i);
        }
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        this._tableau = Array.from({ length: TABLEAU_COLS }, () => []);
        this._faceUpSet = new Set();

        let idx = 0;
        for (let c = 0; c < TABLEAU_COLS; c++) {
            const count = c < 4 ? 6 : 5;
            for (let r = 0; r < count; r++) {
                const id = deck[idx++];
                this._tableau[c].push(id);
                if (r === count - 1) {
                    this._faceUpSet.add(id);
                }
            }
        }
        this._stock = deck.slice(idx);

        this._dragIds = [];
        this._dragSourceCol = -1;
    }

    // ---------------------------------------------------------------------
    // Layout helpers
    // ---------------------------------------------------------------------

    private _slotX(index: number): number {
        const step = this._cardW + this._colGap;
        const totalSpan = (TABLEAU_COLS - 1) * step;
        return -totalSpan / 2 + index * step;
    }

    private _tableauX(col: number): number {
        return this._slotX(col);
    }

    private _tableauPos(col: number, indexInColumn: number): { x: number; y: number } {
        const fanOffset = this._cardH * 0.18;
        return { x: this._tableauX(col), y: this._row2Y - indexInColumn * fanOffset };
    }

    private _stockPos(): { x: number; y: number } {
        return { x: this._slotX(TABLEAU_COLS - 1), y: this._row1Y };
    }

    private _buildSlots(): void {
        if (this._slotsNode) {
            this._slotsNode.destroy();
        }
        this._slotsNode = new Node('Slots');
        this._slotsNode.parent = this.node;
        // Must render above the opaque Background rect but below the cards.
        this._slotsNode.setSiblingIndex(this._cardLayer!.getSiblingIndex());
        this._slotsNode.addComponent(UITransform).setContentSize(this._designW, this._designH);

        const g = this._slotsNode.addComponent(Graphics);
        g.lineWidth = 2;
        g.strokeColor = new Color(230, 235, 230, 180);

        const stockPos = this._stockPos();
        g.roundRect(stockPos.x - this._cardW / 2, stockPos.y - this._cardH / 2, this._cardW, this._cardH, 8);
        for (let c = 0; c < TABLEAU_COLS; c++) {
            const x = this._tableauX(c);
            g.roundRect(x - this._cardW / 2, this._row2Y - this._cardH / 2, this._cardW, this._cardH, 8);
        }
        g.stroke();
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

        this._stock.forEach((id) => place(id, this._stockPos().x, this._stockPos().y, false));

        for (let c = 0; c < TABLEAU_COLS; c++) {
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

    private _locate(id: number): { pile: 'tableau'; col: number } | { pile: 'stock' } {
        for (let c = 0; c < TABLEAU_COLS; c++) {
            if (this._tableau[c].includes(id)) {
                return { pile: 'tableau', col: c };
            }
        }
        return { pile: 'stock' };
    }

    /** Only the stock pile still reacts to a plain click/tap - everything else is drag-driven. */
    private _onCardClicked(id: number): void {
        if (!this._gameActive) {
            return;
        }
        if (this._locate(id).pile === 'stock') {
            this._onStockClicked();
        }
    }

    private _eventToLocal(event: EventTouch): { x: number; y: number } {
        const uiLoc = event.getUILocation();
        const local = this._cardLayer!.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(uiLoc.x, uiLoc.y, 0));
        return { x: local.x, y: local.y };
    }

    private _hitTestDrop(x: number, y: number): number | null {
        const halfStep = (this._cardW + this._colGap) / 2;
        for (let c = 0; c < TABLEAU_COLS; c++) {
            const tx = this._tableauX(c);
            if (Math.abs(x - tx) <= halfStep && y <= this._row2Y + this._cardH / 2) {
                return c;
            }
        }
        return null;
    }

    /** Whether ids (bottom-to-top order) form a single same-suit descending run - required to drag as a group. */
    private _isValidGroupRun(ids: number[]): boolean {
        for (let i = 0; i < ids.length - 1; i++) {
            const lower = this._cardData.get(ids[i])!;
            const upper = this._cardData.get(ids[i + 1])!;
            if (lower.suit !== upper.suit || lower.rank !== upper.rank + 1) {
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
        if (loc.pile !== 'tableau' || !this._faceUpSet.has(id)) {
            return;
        }
        const col = this._tableau[loc.col];
        const candidate = col.slice(col.indexOf(id));
        if (!this._isValidGroupRun(candidate)) {
            return;
        }

        this._dragIds = candidate;
        this._dragSourceCol = loc.col;
        const localPos = this._eventToLocal(event);
        this._dragOffsets = candidate.map((cid) => {
            const n = this._cardNodes.get(cid)!;
            return { x: n.position.x - localPos.x, y: n.position.y - localPos.y };
        });
        candidate.forEach((cid) => {
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
        const sourceCol = this._dragSourceCol;
        this._dragIds = [];
        this._dragSourceCol = -1;
        ids.forEach((cid) => this._cardNodes.get(cid)!.getComponent(PokerCard)!.setSelected(false));

        // Hit-test against the dragged run's actual on-screen position (pointer + its drag
        // offset), not the raw pointer - see Solitaire.ts for why this matters.
        const destCol = this._hitTestDrop(localPos.x + offsets[0].x, localPos.y + offsets[0].y);
        if (destCol === null || !this._tryMove(ids, sourceCol, destCol)) {
            this._renderAll();
        }
    }

    private _canPlaceOnTableau(movingId: number, col: number): boolean {
        const pile = this._tableau[col];
        if (pile.length === 0) {
            return true;
        }
        const moving = this._cardData.get(movingId)!;
        const dest = this._cardData.get(pile[pile.length - 1])!;
        return moving.rank === dest.rank - 1;
    }

    private _tryMove(ids: number[], sourceCol: number, destCol: number): boolean {
        if (sourceCol === destCol || !this._canPlaceOnTableau(ids[0], destCol)) {
            return false;
        }

        const col = this._tableau[sourceCol];
        col.splice(col.length - ids.length, ids.length);
        if (col.length > 0) {
            this._faceUpSet.add(col[col.length - 1]);
        }
        this._tableau[destCol].push(...ids);
        ids.forEach((id) => this._faceUpSet.add(id));

        this._moves++;
        this._updateMovesLabel();
        this._renderAll();
        this._checkCompletedRuns();
        return true;
    }

    private _onStockClicked(): void {
        if (!this._gameActive || this._stock.length === 0) {
            return;
        }
        if (this._tableau.some((col) => col.length === 0)) {
            this._flashStatus('還有空的一行，不能抽牌');
            return;
        }
        for (let c = 0; c < TABLEAU_COLS; c++) {
            const id = this._stock.pop()!;
            this._tableau[c].push(id);
            this._faceUpSet.add(id);
        }
        this._moves++;
        this._updateMovesLabel();
        this._renderAll();
        this._checkCompletedRuns();
    }

    private _flashStatus(message: string): void {
        if (!this._progressLabel) {
            return;
        }
        const original = this._progressLabel.string;
        const originalColor = this._progressLabel.color.clone();
        this._progressLabel.string = message;
        this._progressLabel.color = new Color(190, 60, 40, 255);
        this.scheduleOnce(() => {
            if (this._progressLabel) {
                this._progressLabel.string = original;
                this._progressLabel.color = originalColor;
            }
        }, 1.3);
    }

    // ---------------------------------------------------------------------
    // Completed-run detection / win
    // ---------------------------------------------------------------------

    private _checkCompletedRuns(): void {
        for (let c = 0; c < TABLEAU_COLS; c++) {
            const col = this._tableau[c];
            if (col.length < 13) {
                continue;
            }
            const top13 = col.slice(col.length - 13);
            if (!top13.every((id) => this._faceUpSet.has(id))) {
                continue;
            }
            if (this._cardData.get(top13[0])!.rank !== 13) {
                continue;
            }
            if (!this._isValidGroupRun(top13)) {
                continue;
            }
            col.splice(col.length - 13, 13);
            if (col.length > 0) {
                this._faceUpSet.add(col[col.length - 1]);
            }
            top13.forEach((id) => {
                this._cardNodes.get(id)!.active = false;
            });
            this._completedSets++;
        }
        this._updateProgressLabel();
        if (this._completedSets >= TOTAL_SETS) {
            this._onWin();
        } else {
            this._renderAll();
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
        this._movesLabel = createLabel(bar, '步數：0', -220, 0, 22, new Color(20, 20, 20, 255));
        this._progressLabel = createLabel(bar, '已完成：0/8', 220, 0, 20, new Color(20, 20, 20, 255));

        createButton(bar, this._btnSprites, '選單', -this._designW / 2 + 60, 0, 90, 44, () => {
            this._showMenu();
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

    private _updateProgressLabel(): void {
        if (this._progressLabel) {
            this._progressLabel.string = `已完成：${this._completedSets}/${TOTAL_SETS}`;
        }
    }

    // ---------------------------------------------------------------------
    // Menu overlay (difficulty select)
    // ---------------------------------------------------------------------

    private _buildMenuOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'MenuOverlay', this._designW, this._designH);
        this._menuOverlay = overlay;

        const panel = createPanel(overlay, 420, 440);
        createLabel(panel, '蜘蛛接龍 - 選擇難度', 0, 170, 24, new Color(30, 30, 30, 255));

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

        const panel = createPanel(overlay, 620, 480);
        createLabel(panel, '玩法說明', 0, 205, 26, new Color(30, 30, 30, 255));
        createWrappedLabel(panel, RULES_TEXT, 0, 160, 540, 15, new Color(60, 60, 60, 255));

        createButton(panel, this._btnSprites, '關閉', 0, -205, 160, 48, () => {
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
            this._resultBoardLabel!.string = '此難度尚無紀錄';
        } else {
            const lines = scores.map((s, i) => `${i + 1}. ${s.value}秒　（${s.date}）`);
            this._resultBoardLabel!.string = `排行榜（${this._mode!.label}）\n${lines.join('\n')}`;
        }

        this._resultOverlay!.active = true;
    }
}
