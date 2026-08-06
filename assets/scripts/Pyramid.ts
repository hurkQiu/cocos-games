import {
    _decorator, Component, Node, Prefab, SpriteFrame, Label, Color, UITransform, instantiate, view,
} from 'cc';
import { PokerCard, Suit } from './PokerCard';
import { Leaderboard, ScoreEntry } from './Leaderboard';
import { createFlatRect, createOverlayBackdrop, createPanel, createLabel, createWrappedLabel, createButton, ButtonSprites } from './UiKit';
const { ccclass, property } = _decorator;

const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const RULES_TEXT = '點擊兩張點數加總為 13 的牌，可以把它們一起消除；K（13 點）可以單獨消除。\n\n'
    + '金字塔裡的牌，要等壓在它下方的兩張牌都被移除後才能點擊，最下面一排的牌一開始就能點。\n\n'
    + '點擊抽牌堆可以翻出新的牌到棄牌堆，棄牌堆最上面 3 張都能拿來配對消除；抽完了再點一次會重新洗回抽牌堆。\n\n'
    + '清空整座金字塔即獲勝。';

const LEADERBOARD_KEY = 'pyramid_classic';
const WASTE_ACCESSIBLE_COUNT = 3;

interface CardData {
    rank: number;
    suit: Suit;
}

interface Snapshot {
    pyramid: (number | null)[][];
    stock: number[];
    waste: number[];
}

const MAX_HISTORY = 50;

// ---------------------------------------------------------------------
// Guaranteed-solvable deal generation.
//
// Runs a bounded DFS (rank-only, suit doesn't matter for pairing) against a
// freshly shuffled deck; if it can't confirm a winning line within the node
// budget, the deal is reshuffled and retried rather than treated as proven
// unsolvable (an exhaustive proof is computationally impractical here).
// ---------------------------------------------------------------------

const SOLVE_NODE_BUDGET = 40000;
const SOLVE_MAX_ATTEMPTS = 300;
const SOLVE_MAX_DRAW_STREAK = 50;

function solveIsExposed(pyramid: (number | null)[][], row: number, pos: number): boolean {
    if (pyramid[row][pos] === null) {
        return false;
    }
    if (row === 6) {
        return true;
    }
    return pyramid[row + 1][pos] === null && pyramid[row + 1][pos + 1] === null;
}

function solveRemaining(pyramid: (number | null)[][]): number {
    let count = 0;
    for (const row of pyramid) {
        for (const c of row) {
            if (c !== null) {
                count++;
            }
        }
    }
    return count;
}

function solveKey(pyramid: (number | null)[][], stock: number[], waste: number[]): string {
    return pyramid.map((row) => row.map((c) => (c === null ? '.' : c)).join(',')).join('|')
        + '#' + stock.join(',') + '#' + waste.join(',');
}

/** Whether a pyramid deal (given as ranks only) has a winning line within a bounded search. */
function isPyramidSolvable(pyramid: (number | null)[][], stock: number[]): boolean {
    const visited = new Set<string>();
    let nodes = 0;

    const dfs = (p: (number | null)[][], stock: number[], waste: number[], drawStreak: number): boolean => {
        if (solveRemaining(p) === 0) {
            return true;
        }
        nodes++;
        if (nodes > SOLVE_NODE_BUDGET) {
            return false;
        }
        const key = solveKey(p, stock, waste);
        if (visited.has(key)) {
            return false;
        }
        visited.add(key);

        const exposed: { row: number; pos: number }[] = [];
        for (let row = 0; row < 7; row++) {
            for (let pos = 0; pos <= row; pos++) {
                if (solveIsExposed(p, row, pos)) {
                    exposed.push({ row, pos });
                }
            }
        }
        const accessibleStart = Math.max(0, waste.length - WASTE_ACCESSIBLE_COUNT);
        const accessible = waste.slice(accessibleStart);
        const removeWasteAt = (localIndex: number): number[] => {
            const idx = accessibleStart + localIndex;
            return waste.slice(0, idx).concat(waste.slice(idx + 1));
        };

        for (const e of exposed) {
            if (p[e.row][e.pos] === 13) {
                const next = p.map((r) => r.slice());
                next[e.row][e.pos] = null;
                if (dfs(next, stock, waste, 0)) {
                    return true;
                }
            }
        }
        for (let ai = 0; ai < accessible.length; ai++) {
            if (accessible[ai] === 13 && dfs(p, stock, removeWasteAt(ai), 0)) {
                return true;
            }
        }
        for (let i = 0; i < exposed.length; i++) {
            for (let j = i + 1; j < exposed.length; j++) {
                const a = p[exposed[i].row][exposed[i].pos]!;
                const b = p[exposed[j].row][exposed[j].pos]!;
                if (a + b === 13) {
                    const next = p.map((r) => r.slice());
                    next[exposed[i].row][exposed[i].pos] = null;
                    next[exposed[j].row][exposed[j].pos] = null;
                    if (dfs(next, stock, waste, 0)) {
                        return true;
                    }
                }
            }
        }
        for (let ai = 0; ai < accessible.length; ai++) {
            for (const e of exposed) {
                if (p[e.row][e.pos]! + accessible[ai] === 13) {
                    const next = p.map((r) => r.slice());
                    next[e.row][e.pos] = null;
                    if (dfs(next, stock, removeWasteAt(ai), 0)) {
                        return true;
                    }
                }
            }
        }
        if (drawStreak < SOLVE_MAX_DRAW_STREAK) {
            if (stock.length > 0) {
                const nextStock = stock.slice(0, -1);
                const nextWaste = waste.concat(stock[stock.length - 1]);
                if (dfs(p, nextStock, nextWaste, drawStreak + 1)) {
                    return true;
                }
            } else if (waste.length > 0) {
                const nextStock = waste.slice().reverse();
                if (dfs(p, nextStock, [], drawStreak + 1)) {
                    return true;
                }
            }
        }

        return false;
    };

    return dfs(pyramid, stock, [], 0);
}

@ccclass('Pyramid')
export class Pyramid extends Component {
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
    private _topY = 0;
    private _stockY = 0;
    private readonly _marginX = 24;

    private _topBar: Node | null = null;
    private _timeLabel: Label | null = null;
    private _remainingLabel: Label | null = null;
    private _deadEndLabel: Label | null = null;
    private _menuOverlay: Node | null = null;
    private _rulesOverlay: Node | null = null;
    private _resultOverlay: Node | null = null;
    private _resultTitleLabel: Label | null = null;
    private _resultTimeLabel: Label | null = null;
    private _resultBoardLabel: Label | null = null;

    private _cardLayer: Node | null = null;
    private _cardData: Map<number, CardData> = new Map();
    private _cardNodes: Map<number, Node> = new Map();

    private _pyramid: (number | null)[][] = [];
    private _stock: number[] = [];
    private _waste: number[] = [];
    private _selected: number | null = null;
    private _history: Snapshot[] = [];

    private _elapsed = 0;
    private _gameActive = false;

    private get _btnSprites(): ButtonSprites {
        return { normal: this.sfBtnNormal, pressed: this.sfBtnPressed, disabled: this.sfBtnDisabled };
    }

    protected onLoad(): void {
        const visible = view.getVisibleSize();
        this._designW = visible.width;
        this._designH = visible.height;
        this.getComponent(UITransform)?.setContentSize(this._designW, this._designH);

        this._cardW = Math.floor((this._designW - this._marginX * 2) / 7);
        this._cardW = Math.max(60, Math.min(120, this._cardW));
        this._cardH = Math.floor(this._cardW * 1.4);
        this._topY = this._designH / 2 - 90 - this._cardH / 2;
        this._stockY = -this._designH / 2 + 20 + this._cardH / 2;

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

    private _startGame(): void {
        this._elapsed = 0;
        this._gameActive = true;

        this._buildDeckData();
        this._createCardNodes();
        this._deal();

        this._updateTimeLabel();
        this._updateRemainingLabel();

        this._menuOverlay!.active = false;
        this._resultOverlay!.active = false;
        this._topBar!.active = true;
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
            this._cardNodes.set(id, node);
        }
    }

    private _deal(): void {
        let pyramid: (number | null)[][] = [];
        let stock: number[] = [];

        for (let attempt = 0; attempt < SOLVE_MAX_ATTEMPTS; attempt++) {
            const deck: number[] = [];
            for (let i = 0; i < 52; i++) {
                deck.push(i);
            }
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            pyramid = [];
            let idx = 0;
            for (let row = 0; row < 7; row++) {
                const cards: (number | null)[] = [];
                for (let p = 0; p <= row; p++) {
                    cards.push(deck[idx++]);
                }
                pyramid.push(cards);
            }
            stock = deck.slice(idx);

            const rankPyramid = pyramid.map((row) => row.map((id) => (id === null ? null : this._cardData.get(id)!.rank)));
            const rankStock = stock.map((id) => this._cardData.get(id)!.rank);
            if (isPyramidSolvable(rankPyramid, rankStock)) {
                break;
            }
        }

        this._pyramid = pyramid;
        this._stock = stock;
        this._waste = [];
        this._selected = null;
        this._history = [];
    }

    // ---------------------------------------------------------------------
    // Layout helpers
    // ---------------------------------------------------------------------

    private _pyramidX(row: number, pos: number): number {
        return (pos - row / 2) * this._cardW;
    }

    private _pyramidY(row: number): number {
        return this._topY - row * this._cardH * 0.55;
    }

    private _stockPos(): { x: number; y: number } {
        return { x: this._designW / 2 - this._marginX - this._cardW / 2, y: this._stockY };
    }

    private _wastePos(fanIndex: number, fanCount: number): { x: number; y: number } {
        const baseX = this._designW / 2 - this._marginX - this._cardW * 2.1;
        const spread = this._cardW * 0.32;
        return { x: baseX + (fanIndex - (fanCount - 1)) * spread, y: this._stockY };
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    private _isExposed(row: number, pos: number): boolean {
        if (this._pyramid[row][pos] === null) {
            return false;
        }
        if (row === 6) {
            return true;
        }
        return this._pyramid[row + 1][pos] === null && this._pyramid[row + 1][pos + 1] === null;
    }

    private _renderAll(): void {
        let order = 0;

        for (let row = 0; row <= 6; row++) {
            for (let p = 0; p <= row; p++) {
                const id = this._pyramid[row][p];
                if (id === null) {
                    continue;
                }
                const node = this._cardNodes.get(id)!;
                node.active = true;
                node.setPosition(this._pyramidX(row, p), this._pyramidY(row), 0);
                node.setSiblingIndex(order++);
                const card = node.getComponent(PokerCard)!;
                if (!card.faceUp) {
                    card.setFaceUp(true);
                }
                card.setSelected(this._selected === id);
            }
        }

        this._stock.forEach((id) => {
            const node = this._cardNodes.get(id)!;
            node.active = true;
            const pos = this._stockPos();
            node.setPosition(pos.x, pos.y, 0);
            node.setSiblingIndex(order++);
            const card = node.getComponent(PokerCard)!;
            if (card.faceUp) {
                card.setFaceUp(false);
            }
        });

        const shownWaste = this._waste.slice(-WASTE_ACCESSIBLE_COUNT);
        this._waste.slice(0, -WASTE_ACCESSIBLE_COUNT).forEach((id) => {
            this._cardNodes.get(id)!.active = false;
        });
        shownWaste.forEach((id, i) => {
            const node = this._cardNodes.get(id)!;
            node.active = true;
            const pos = this._wastePos(i, shownWaste.length);
            node.setPosition(pos.x, pos.y, 0);
            node.setSiblingIndex(order++);
            const card = node.getComponent(PokerCard)!;
            if (!card.faceUp) {
                card.setFaceUp(true);
            }
            card.setSelected(this._selected === id);
        });
    }

    // ---------------------------------------------------------------------
    // Input
    // ---------------------------------------------------------------------

    private _locatePyramid(id: number): { row: number; pos: number } | null {
        for (let row = 0; row < 7; row++) {
            const p = this._pyramid[row].indexOf(id);
            if (p !== -1) {
                return { row, pos: p };
            }
        }
        return null;
    }

    private _onCardClicked(id: number): void {
        if (!this._gameActive) {
            return;
        }
        const loc = this._locatePyramid(id);
        if (loc) {
            if (!this._isExposed(loc.row, loc.pos)) {
                return;
            }
            this._handleSelect(id);
            return;
        }
        if (this._waste.slice(-WASTE_ACCESSIBLE_COUNT).includes(id)) {
            this._handleSelect(id);
            return;
        }
        if (this._stock.includes(id)) {
            this._drawFromStock();
        }
    }

    private _handleSelect(id: number): void {
        const rank = this._cardData.get(id)!.rank;

        if (this._selected === null) {
            if (rank === 13) {
                this._removeSingle(id);
                return;
            }
            this._selected = id;
            this._renderAll();
            return;
        }

        if (this._selected === id) {
            this._selected = null;
            this._renderAll();
            return;
        }

        // Two waste cards can't pair with each other: it never helps clear the
        // pyramid and would just burn a card another exposed slot might still need.
        const bothInWaste = this._waste.includes(this._selected) && this._waste.includes(id);
        const otherRank = this._cardData.get(this._selected)!.rank;
        if (!bothInWaste && rank + otherRank === 13) {
            this._removePair(this._selected, id);
            return;
        }

        if (rank === 13) {
            this._removeSingle(id);
            return;
        }

        this._selected = id;
        this._renderAll();
    }

    private _removeFromWherever(id: number): void {
        const loc = this._locatePyramid(id);
        if (loc) {
            this._pyramid[loc.row][loc.pos] = null;
            return;
        }
        const wasteIdx = this._waste.indexOf(id);
        if (wasteIdx !== -1) {
            this._waste.splice(wasteIdx, 1);
        }
    }

    private _removePair(idA: number, idB: number): void {
        this._pushHistory();
        this._removeFromWherever(idA);
        this._removeFromWherever(idB);
        this._cardNodes.get(idA)!.active = false;
        this._cardNodes.get(idB)!.active = false;
        this._selected = null;
        this._updateRemainingLabel();
        this._renderAll();
        this._checkWin();
        this._updateDeadEndLabel();
    }

    private _removeSingle(id: number): void {
        this._pushHistory();
        this._removeFromWherever(id);
        this._cardNodes.get(id)!.active = false;
        this._updateRemainingLabel();
        this._renderAll();
        this._checkWin();
        this._updateDeadEndLabel();
    }

    private _drawFromStock(): void {
        this._pushHistory();
        if (this._stock.length === 0) {
            this._stock = this._waste.slice().reverse();
            this._waste = [];
        } else {
            const id = this._stock.pop()!;
            this._waste.push(id);
        }
        this._selected = null;
        this._renderAll();
        this._updateDeadEndLabel();
    }

    // ---------------------------------------------------------------------
    // Undo / dead-end detection
    // ---------------------------------------------------------------------

    private _pushHistory(): void {
        this._history.push({
            pyramid: this._pyramid.map((row) => row.slice()),
            stock: this._stock.slice(),
            waste: this._waste.slice(),
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
        this._pyramid = snap.pyramid;
        this._stock = snap.stock;
        this._waste = snap.waste;
        this._selected = null;
        this._updateRemainingLabel();
        this._renderAll();
        this._updateDeadEndLabel();
    }

    /** Heuristic "no legal move exists right now, or ever will by cycling the stock" check. */
    private _isDeadEnd(): boolean {
        const exposedRanks: number[] = [];
        for (let row = 0; row < 7; row++) {
            for (let p = 0; p <= row; p++) {
                const id = this._pyramid[row][p];
                if (id !== null && this._isExposed(row, p)) {
                    exposedRanks.push(this._cardData.get(id)!.rank);
                }
            }
        }
        this._waste.slice(-WASTE_ACCESSIBLE_COUNT).forEach((id) => {
            exposedRanks.push(this._cardData.get(id)!.rank);
        });

        if (exposedRanks.some((r) => r === 13)) {
            return false;
        }
        for (let i = 0; i < exposedRanks.length; i++) {
            for (let j = i + 1; j < exposedRanks.length; j++) {
                if (exposedRanks[i] + exposedRanks[j] === 13) {
                    return false;
                }
            }
        }

        // Anything still hidden in the stock/waste will eventually surface as the
        // waste's top card via cycling, so check it against the currently exposed set too.
        const hiddenPool = this._stock
            .concat(this._waste.slice(0, -WASTE_ACCESSIBLE_COUNT))
            .map((id) => this._cardData.get(id)!.rank);
        if (hiddenPool.some((r) => r === 13)) {
            return false;
        }
        for (const er of exposedRanks) {
            if (hiddenPool.some((hr) => hr + er === 13)) {
                return false;
            }
        }
        return true;
    }

    private _updateDeadEndLabel(): void {
        if (!this._deadEndLabel) {
            return;
        }
        this._deadEndLabel.node.active = this._gameActive && this._isDeadEnd();
    }

    private _remainingCount(): number {
        let count = 0;
        for (const row of this._pyramid) {
            for (const id of row) {
                if (id !== null) {
                    count++;
                }
            }
        }
        return count;
    }

    private _checkWin(): void {
        if (this._remainingCount() === 0) {
            this._onWin();
        }
    }

    private _onWin(): void {
        this._gameActive = false;
        const timeSec = Math.floor(this._elapsed);
        const scores = Leaderboard.submit(LEADERBOARD_KEY, timeSec, true);
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
        this._remainingLabel = createLabel(bar, '剩餘：28', -160, 0, 22, new Color(20, 20, 20, 255));
        this._deadEndLabel = createLabel(bar, '目前沒有可行的步驟', 160, 0, 16, new Color(190, 60, 40, 255));
        this._deadEndLabel.node.active = false;

        createButton(bar, this._btnSprites, '選單', -this._designW / 2 + 60, 0, 90, 44, () => {
            this._showMenu();
        });
        createButton(bar, this._btnSprites, '回上一步', -this._designW / 2 + 175, 0, 120, 44, () => {
            this._undo();
        });
        createButton(bar, this._btnSprites, '重新開始', this._designW / 2 - 70, 0, 110, 44, () => {
            this._startGame();
        });
    }

    private _updateTimeLabel(): void {
        if (this._timeLabel) {
            this._timeLabel.string = `時間：${Math.floor(this._elapsed)}秒`;
        }
    }

    private _updateRemainingLabel(): void {
        if (this._remainingLabel) {
            this._remainingLabel.string = `剩餘：${this._remainingCount()}`;
        }
    }

    // ---------------------------------------------------------------------
    // Menu overlay
    // ---------------------------------------------------------------------

    private _buildMenuOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'MenuOverlay', this._designW, this._designH);
        this._menuOverlay = overlay;

        const panel = createPanel(overlay, 400, 340);
        createLabel(panel, '金字塔接龍', 0, 120, 28, new Color(30, 30, 30, 255));

        createButton(panel, this._btnSprites, '開始遊戲', 0, 40, 220, 56, () => {
            this._startGame();
        });

        const best = Leaderboard.getScores(LEADERBOARD_KEY)[0];
        createLabel(panel, best ? `最佳：${best.value}秒` : '最佳：--', 0, -30, 16, new Color(90, 90, 90, 255));

        createButton(panel, this._btnSprites, '玩法說明', -100, -110, 180, 44, () => {
            this._showRules();
        });
        createButton(panel, this._btnSprites, '返回遊戲選單', 110, -110, 180, 44, () => {
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
        if (this._cardLayer) {
            this._cardLayer.active = false;
        }
    }

    private _refreshMenuOverlay(): void {
        const panel = this._menuOverlay!.getChildByName('Panel')!;
        const labels = panel.children.filter((n) => n.name === 'Label');
        const bestLabelNode = labels[labels.length - 1];
        const best = Leaderboard.getScores(LEADERBOARD_KEY)[0];
        bestLabelNode.getComponent(Label)!.string = best ? `最佳：${best.value}秒` : '最佳：--';
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
        createWrappedLabel(panel, RULES_TEXT, 0, 155, 480, 15, new Color(60, 60, 60, 255));

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

        const panel = createPanel(overlay, 420, 400);
        this._resultTitleLabel = createLabel(panel, '獲勝！', 0, 150, 28, new Color(30, 130, 60, 255));
        this._resultTimeLabel = createLabel(panel, '時間：0秒', 0, 105, 20, new Color(60, 60, 60, 255));
        this._resultBoardLabel = createLabel(panel, '', 0, 20, 16, new Color(70, 70, 70, 255));

        createButton(panel, this._btnSprites, '再玩一次', -90, -150, 160, 48, () => {
            this._startGame();
        });
        createButton(panel, this._btnSprites, '選單', 90, -150, 160, 48, () => {
            this._showMenu();
        });
    }

    private _showResult(timeSec: number, scores: ScoreEntry[]): void {
        this._resultTitleLabel!.string = '獲勝！';
        this._resultTimeLabel!.string = `時間：${timeSec}秒`;

        if (scores.length === 0) {
            this._resultBoardLabel!.string = '尚無紀錄';
        } else {
            const lines = scores.map((s, i) => `${i + 1}. ${s.value}秒　（${s.date}）`);
            this._resultBoardLabel!.string = `排行榜\n${lines.join('\n')}`;
        }

        this._resultOverlay!.active = true;
    }
}
