import {
    _decorator, Component, Node, Prefab, SpriteFrame, Label, Color, UITransform, instantiate, Button, view,
} from 'cc';
import { PokerCard, Suit } from './PokerCard';
import { Leaderboard } from './Leaderboard';
import { createFlatRect, createOverlayBackdrop, createPanel, createLabel, createWrappedLabel, createButton, ButtonSprites } from './UiKit';
const { ccclass, property } = _decorator;

const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const RULES_TEXT = '大老二使用一副 52 張牌（不含鬼牌），牌面大小由小到大為：3 4 5 6 7 8 9 10 J Q K A 2；花色僅在點數相同時用來比大小，由小到大為方塊、梅花、紅心、黑桃。\n\n'
    + '可以出的牌型有：單張、對子、三條，以及由 5 張牌組成的順子、同花、葫蘆（三條+一對）、鐵支（四張+一張）、同花順，大小依序遞增；順子不可包含 2。\n\n'
    + '持有方塊 3 的人先出牌，且第一次出牌必須包含方塊 3。之後每輪出牌張數要跟上一手相同、牌型要壓過上一手，否則只能跳過；若其他人都跳過，換上一手出牌的人自由出牌（可出任意牌型）。\n\n'
    + '誰先把手牌出完就獲勝！';

interface GameMode {
    key: string;
    label: string;
    totalPlayers: number;
}

const MODES: GameMode[] = [
    { key: 'p3', label: '3 人（配 2 個電腦）', totalPlayers: 3 },
    { key: 'p4', label: '4 人（配 3 個電腦）', totalPlayers: 4 },
];

function leaderboardKey(modeKey: string): string {
    return `bigtwo_${modeKey}_streak`;
}

// ---------------------------------------------------------------------
// Combo detection & comparison (rank/suit only, independent of `this`).
// ---------------------------------------------------------------------

type ComboKind = 'single' | 'pair' | 'triple' | 'straight' | 'flush' | 'fullhouse' | 'fourkind' | 'straightflush';

interface Combo {
    kind: ComboKind;
    cards: number[];
    power: number;
}

const FIVE_KIND_RANK: Record<string, number> = {
    straight: 0,
    flush: 1,
    fullhouse: 2,
    fourkind: 3,
    straightflush: 4,
};

const BIG_TWO_SUIT_POWER: Record<number, number> = {
    [Suit.Diamond]: 0,
    [Suit.Club]: 1,
    [Suit.Heart]: 2,
    [Suit.Spade]: 3,
};

/** 3 is the lowest rank and 2 is the highest; everything else keeps its natural order. */
function bigTwoRankPower(rank: number): number {
    if (rank === 1) {
        return 11;
    }
    if (rank === 2) {
        return 12;
    }
    return rank - 3;
}

function suitPower(suit: Suit): number {
    return BIG_TWO_SUIT_POWER[suit];
}

/** Returns null if the given cards don't form any legal Big Two combo. */
function detectCombo(cardIds: number[], cardData: Map<number, { rank: number; suit: Suit }>): Combo | null {
    const n = cardIds.length;
    if (n !== 1 && n !== 2 && n !== 3 && n !== 5) {
        return null;
    }
    const cards = cardIds.map((id) => ({ id, ...cardData.get(id)! }));

    if (n === 1) {
        return { kind: 'single', cards: cardIds, power: bigTwoRankPower(cards[0].rank) * 4 + suitPower(cards[0].suit) };
    }
    if (n === 2) {
        if (cards[0].rank !== cards[1].rank) {
            return null;
        }
        const power = bigTwoRankPower(cards[0].rank) * 4 + Math.max(suitPower(cards[0].suit), suitPower(cards[1].suit));
        return { kind: 'pair', cards: cardIds, power };
    }
    if (n === 3) {
        if (cards[0].rank !== cards[1].rank || cards[1].rank !== cards[2].rank) {
            return null;
        }
        return { kind: 'triple', cards: cardIds, power: bigTwoRankPower(cards[0].rank) };
    }

    // n === 5
    const rankCounts = new Map<number, number>();
    cards.forEach((c) => rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1));
    const countValues = Array.from(rankCounts.values()).sort((a, b) => b - a);
    const allSameSuit = cards.every((c) => c.suit === cards[0].suit);

    let isStraight = false;
    let straightTopPower = -1;
    let straightTopSuit: Suit = cards[0].suit;
    if (countValues.length === 5 && cards.every((c) => c.rank !== 2)) {
        const sorted = cards.slice().sort((a, b) => bigTwoRankPower(a.rank) - bigTwoRankPower(b.rank));
        const powers = sorted.map((c) => bigTwoRankPower(c.rank));
        isStraight = powers.every((p, i) => i === 0 || p === powers[i - 1] + 1);
        if (isStraight) {
            straightTopPower = powers[4];
            straightTopSuit = sorted[4].suit;
        }
    }

    if (isStraight && allSameSuit) {
        return { kind: 'straightflush', cards: cardIds, power: straightTopPower * 4 + suitPower(straightTopSuit) };
    }
    if (countValues[0] === 4) {
        const quadRank = Array.from(rankCounts.entries()).find(([, c]) => c === 4)![0];
        return { kind: 'fourkind', cards: cardIds, power: bigTwoRankPower(quadRank) };
    }
    if (countValues[0] === 3 && countValues[1] === 2) {
        const tripleRank = Array.from(rankCounts.entries()).find(([, c]) => c === 3)![0];
        return { kind: 'fullhouse', cards: cardIds, power: bigTwoRankPower(tripleRank) };
    }
    if (allSameSuit) {
        const top = cards.reduce((best, c) => (bigTwoRankPower(c.rank) > bigTwoRankPower(best.rank) ? c : best));
        return { kind: 'flush', cards: cardIds, power: bigTwoRankPower(top.rank) * 4 + suitPower(top.suit) };
    }
    if (isStraight) {
        return { kind: 'straight', cards: cardIds, power: straightTopPower * 4 + suitPower(straightTopSuit) };
    }
    return null;
}

function comboBeats(a: Combo, b: Combo): boolean {
    if (a.cards.length !== b.cards.length) {
        return false;
    }
    if (a.cards.length === 5 && a.kind !== b.kind) {
        return FIVE_KIND_RANK[a.kind] > FIVE_KIND_RANK[b.kind];
    }
    return a.power > b.power;
}

function combinationsOf5(arr: number[]): number[][] {
    const result: number[][] = [];
    const n = arr.length;
    for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
            for (let c = b + 1; c < n; c++) {
                for (let d = c + 1; d < n; d++) {
                    for (let e = d + 1; e < n; e++) {
                        result.push([arr[a], arr[b], arr[c], arr[d], arr[e]]);
                    }
                }
            }
        }
    }
    return result;
}

@ccclass('BigTwo')
export class BigTwo extends Component {
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

    private _topBar: Node | null = null;
    private _statusLabel: Label | null = null;
    private _menuOverlay: Node | null = null;
    private _rulesOverlay: Node | null = null;
    private _resultOverlay: Node | null = null;
    private _resultTitleLabel: Label | null = null;
    private _resultSubLabel: Label | null = null;

    private _tableLayer: Node | null = null;
    private _handLayer: Node | null = null;
    private _aiInfoLayer: Node | null = null;
    private _aiLabels: Label[] = [];
    private _aiPassLabels: Label[] = [];
    private _aiPassed: boolean[] = [];
    private _playBtn: Node | null = null;
    private _passBtn: Node | null = null;

    private _cardLayer: Node | null = null;
    private _cardData: Map<number, { rank: number; suit: Suit }> = new Map();
    private _cardNodes: Map<number, Node> = new Map();

    private _mode: GameMode | null = null;
    private _totalPlayers = 3;
    private _hands: number[][] = [];
    private _selected: Set<number> = new Set();
    private _currentCombo: Combo | null = null;
    private _currentPlayedBy = -1;
    private _trickPlays: { playerIndex: number; combo: Combo }[] = [];
    private _turn = 0;
    private _passStreak = 0;
    private _isFirstTrick = true;
    private _streak = 0;
    private _gameActive = false;

    private get _btnSprites(): ButtonSprites {
        return { normal: this.sfBtnNormal, pressed: this.sfBtnPressed, disabled: this.sfBtnDisabled };
    }

    protected onLoad(): void {
        const visible = view.getVisibleSize();
        this._designW = visible.width;
        this._designH = visible.height;
        this.getComponent(UITransform)?.setContentSize(this._designW, this._designH);

        this._cardW = Math.max(64, Math.min(100, Math.floor(this._designW / 20)));
        this._cardH = Math.floor(this._cardW * 1.4);

        this._buildDeckData();

        createFlatRect(this.node, 'Background', this._designW, this._designH, new Color(20, 90, 55, 255));

        this._buildTopBar();
        this._buildTable();
        this._buildHandArea();
        this._buildAiInfo();
        this._buildMenuOverlay();
        this._buildRulesOverlay();
        this._buildResultOverlay();

        this._showMenu();
    }

    private _buildDeckData(): void {
        for (let s = 0; s < 4; s++) {
            for (let r = 1; r <= 13; r++) {
                this._cardData.set(s * 13 + (r - 1), { rank: r, suit: s as Suit });
            }
        }
    }

    // ---------------------------------------------------------------------
    // Dealing / setup
    // ---------------------------------------------------------------------

    private _startGame(mode: GameMode): void {
        this._mode = mode;
        this._totalPlayers = mode.totalPlayers;
        this._streak = 0;

        this._createCardNodes();
        this._dealCards();

        this._currentCombo = null;
        this._currentPlayedBy = -1;
        this._trickPlays = [];
        this._passStreak = 0;
        this._isFirstTrick = true;
        this._selected.clear();
        this._gameActive = true;
        this._turn = this._findStartingPlayer();

        this._buildAiInfo();

        this._menuOverlay!.active = false;
        this._resultOverlay!.active = false;
        this._topBar!.active = true;
        this._tableLayer!.active = true;
        this._handLayer!.active = true;
        this._aiInfoLayer!.active = true;

        this._renderAll();
        this._maybeRunAi();
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

    private _dealCards(): void {
        const deck: number[] = [];
        for (let i = 0; i < 52; i++) {
            deck.push(i);
        }
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        this._hands = Array.from({ length: this._totalPlayers }, () => []);
        let p = 0;
        deck.forEach((id) => {
            this._hands[p].push(id);
            p = (p + 1) % this._totalPlayers;
        });
        this._hands.forEach((hand) => hand.sort((a, b) => this._cardPower(a) - this._cardPower(b)));
    }

    private _cardPower(id: number): number {
        const data = this._cardData.get(id)!;
        return bigTwoRankPower(data.rank) * 4 + suitPower(data.suit);
    }

    private _findThreeDiamondId(): number {
        for (const [id, data] of this._cardData) {
            if (data.rank === 3 && data.suit === Suit.Diamond) {
                return id;
            }
        }
        return -1;
    }

    private _findStartingPlayer(): number {
        const threeDiamondId = this._findThreeDiamondId();
        for (let p = 0; p < this._totalPlayers; p++) {
            if (this._hands[p].includes(threeDiamondId)) {
                return p;
            }
        }
        return 0;
    }

    // ---------------------------------------------------------------------
    // Layout helpers
    // ---------------------------------------------------------------------

    private _handCardX(index: number, count: number): number {
        const maxWidth = this._designW - 160;
        const step = count > 1 ? Math.min(this._cardW * 0.62, maxWidth / (count - 1)) : 0;
        return -(step * (count - 1)) / 2 + index * step;
    }

    private _handY(): number {
        return -this._designH / 2 + 50 + this._cardH / 2;
    }

    private _tableY(): number {
        return 30;
    }

    /** Deterministic per-card pseudo-randomness (based on id) so the "tossed down" look stays stable across re-renders. */
    private _cardJitter(id: number): { dx: number; dy: number; angle: number } {
        const a = (id * 2654435761) % 1000 / 1000;
        const b = (id * 40503 + 17) % 1000 / 1000;
        return { dx: (b - 0.5) * 10, dy: (a - 0.5) * 8, angle: (a - 0.5) * 22 };
    }

    /** Played cards fan out with a slight per-card rotation/offset instead of stacking perfectly flush. */
    private _tableCardPos(id: number, index: number, count: number): { x: number; y: number; angle: number } {
        const step = this._cardW * 0.55;
        const baseX = -(step * (count - 1)) / 2 + index * step;
        const jitter = this._cardJitter(id);
        return { x: baseX + jitter.dx, y: this._tableY() + jitter.dy, angle: jitter.angle };
    }

    /**
     * Every play made this game stays on the table (so players can see the full history of
     * what's gone by) instead of being cleared once a stronger combo lands or a trick ends.
     * Each subsequent play is placed further from the centre along a golden-angle spiral, so
     * plays spread out evenly in all directions instead of piling up along one fixed line.
     */
    private _trickCascadeOffset(playIndex: number): { x: number; y: number } {
        const angle = playIndex * 137.5 * (Math.PI / 180);
        const radius = 24 * Math.sqrt(playIndex);
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }

    private _aiInfoPos(aiSlot: number): { x: number; y: number } {
        const aiCount = this._totalPlayers - 1;
        if (aiCount === 2) {
            return aiSlot === 0
                ? { x: -this._designW / 2 + 170, y: this._designH / 2 - 170 }
                : { x: this._designW / 2 - 170, y: this._designH / 2 - 170 };
        }
        if (aiSlot === 0) {
            return { x: -this._designW / 2 + 170, y: 0 };
        }
        if (aiSlot === 1) {
            return { x: 0, y: this._designH / 2 - 170 };
        }
        return { x: this._designW / 2 - 170, y: 0 };
    }

    /** AI hands render as a tight face-down stack (card count visible, identities hidden) below their info label. */
    private _aiHandCardPos(aiSlot: number, index: number, count: number): { x: number; y: number } {
        const base = this._aiInfoPos(aiSlot);
        const step = count > 1 ? Math.min(14, 170 / (count - 1)) : 0;
        const y = base.y - this._cardH / 2 - 40;
        return { x: base.x - (step * (count - 1)) / 2 + index * step, y };
    }

    private _aiPassLabelY(aiSlot: number): number {
        const base = this._aiInfoPos(aiSlot);
        return base.y - this._cardH - 60;
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    private _renderAll(): void {
        let order = 0;
        const visible = new Set<number>();

        const hand = this._hands[0] ?? [];
        hand.forEach((id, i) => {
            const node = this._cardNodes.get(id)!;
            visible.add(id);
            node.active = true;
            node.angle = 0;
            node.setPosition(this._handCardX(i, hand.length), this._handY(), 0);
            node.setSiblingIndex(order++);
            const card = node.getComponent(PokerCard)!;
            if (!card.faceUp) {
                card.setFaceUp(true);
            }
            card.setSelected(this._selected.has(id));
        });

        for (let slot = 0; slot < this._totalPlayers - 1; slot++) {
            const playerIndex = slot + 1;
            const aiHand = this._hands[playerIndex] ?? [];
            aiHand.forEach((id, i) => {
                const node = this._cardNodes.get(id)!;
                visible.add(id);
                node.active = true;
                node.angle = 0;
                const pos = this._aiHandCardPos(slot, i, aiHand.length);
                node.setPosition(pos.x, pos.y, 0);
                node.setSiblingIndex(order++);
                const card = node.getComponent(PokerCard)!;
                if (card.faceUp) {
                    card.setFaceUp(false);
                }
                card.setSelected(false);
            });
        }

        this._trickPlays.forEach((play, playIndex) => {
            const cascade = this._trickCascadeOffset(playIndex);
            play.combo.cards.forEach((id, i) => {
                const node = this._cardNodes.get(id)!;
                visible.add(id);
                node.active = true;
                const pos = this._tableCardPos(id, i, play.combo.cards.length);
                node.setPosition(pos.x + cascade.x, pos.y + cascade.y, 0);
                node.angle = pos.angle;
                node.setSiblingIndex(order++);
                const card = node.getComponent(PokerCard)!;
                if (!card.faceUp) {
                    card.setFaceUp(true);
                }
                card.setSelected(false);
            });
        });

        this._cardNodes.forEach((node, id) => {
            if (!visible.has(id)) {
                node.active = false;
            }
        });

        this._updateAiInfoLabels();
        this._updateStatusLabel();
        this._updateActionButtons();
    }

    private _updateAiInfoLabels(): void {
        for (let slot = 0; slot < this._totalPlayers - 1; slot++) {
            const label = this._aiLabels[slot];
            if (!label) {
                continue;
            }
            const playerIndex = slot + 1;
            const count = this._hands[playerIndex]?.length ?? 0;
            const thinking = this._gameActive && this._turn === playerIndex ? '（思考中）' : '';
            label.string = `電腦 ${slot + 1}：${count} 張${thinking}`;

            const passLabel = this._aiPassLabels[slot];
            if (passLabel) {
                passLabel.node.active = this._gameActive && !!this._aiPassed[slot];
            }
        }
    }

    private _updateStatusLabel(): void {
        if (!this._statusLabel) {
            return;
        }
        if (!this._gameActive) {
            this._statusLabel.string = '';
            return;
        }
        if (this._turn === 0) {
            this._statusLabel.string = this._currentCombo === null ? '輪到你出牌（自由出牌）' : '輪到你出牌或跳過';
        } else {
            this._statusLabel.string = `電腦 ${this._turn} 思考中...`;
        }
    }

    private _updateActionButtons(): void {
        const humanTurn = this._gameActive && this._turn === 0;
        const canPass = humanTurn && this._currentCombo !== null;
        const playBtn = this._playBtn?.getComponent(Button);
        const passBtn = this._passBtn?.getComponent(Button);
        if (playBtn) {
            playBtn.interactable = humanTurn;
        }
        if (passBtn) {
            passBtn.interactable = canPass;
        }
    }

    // ---------------------------------------------------------------------
    // Input
    // ---------------------------------------------------------------------

    private _onCardClicked(id: number): void {
        if (!this._gameActive || this._turn !== 0) {
            return;
        }
        if (!this._hands[0].includes(id)) {
            return;
        }
        if (this._selected.has(id)) {
            this._selected.delete(id);
        } else {
            this._selected.add(id);
        }
        this._renderAll();
    }

    private _onPlayClicked(): void {
        if (!this._gameActive || this._turn !== 0) {
            return;
        }
        const ids = Array.from(this._selected);
        const combo = detectCombo(ids, this._cardData);
        if (!combo) {
            this._flashStatus('這不是合法的牌型');
            return;
        }
        if (this._isFirstTrick && this._currentCombo === null && !combo.cards.includes(this._findThreeDiamondId())) {
            this._flashStatus('第一次出牌必須包含方塊 3');
            return;
        }
        if (this._currentCombo !== null) {
            if (combo.cards.length !== this._currentCombo.cards.length) {
                this._flashStatus(`必須出跟上一手一樣的張數（${this._currentCombo.cards.length} 張）`);
                return;
            }
            if (!comboBeats(combo, this._currentCombo)) {
                this._flashStatus('牌型壓不過上一手');
                return;
            }
        }
        this._commitPlay(0, combo);
    }

    private _onPassClicked(): void {
        if (!this._gameActive || this._turn !== 0 || this._currentCombo === null) {
            return;
        }
        this._selected.clear();
        this._commitPass(0);
    }

    private _flashStatus(message: string): void {
        if (!this._statusLabel) {
            return;
        }
        this._statusLabel.string = message;
        this._statusLabel.color = new Color(190, 60, 40, 255);
        this.scheduleOnce(() => {
            this._statusLabel!.color = new Color(255, 255, 255, 255);
            this._updateStatusLabel();
        }, 1.3);
    }

    // ---------------------------------------------------------------------
    // Game flow
    // ---------------------------------------------------------------------

    private _commitPlay(playerIndex: number, combo: Combo): void {
        const hand = this._hands[playerIndex];
        combo.cards.forEach((id) => {
            const idx = hand.indexOf(id);
            if (idx !== -1) {
                hand.splice(idx, 1);
            }
        });
        this._currentCombo = combo;
        this._currentPlayedBy = playerIndex;
        this._trickPlays.push({ playerIndex, combo });
        this._passStreak = 0;
        this._isFirstTrick = false;
        this._selected.clear();
        if (playerIndex > 0) {
            this._aiPassed[playerIndex - 1] = false;
        }
        this._renderAll();

        if (hand.length === 0) {
            this._onGameEnd(playerIndex);
            return;
        }
        this._advanceTurn();
    }

    private _commitPass(playerIndex: number): void {
        if (playerIndex > 0) {
            this._aiPassed[playerIndex - 1] = true;
        }
        this._passStreak++;
        if (this._passStreak >= this._totalPlayers - 1) {
            this._currentCombo = null;
            this._turn = this._currentPlayedBy;
            this._passStreak = 0;
            this._aiPassed = this._aiPassed.map(() => false);
            this._renderAll();
            this._maybeRunAi();
            return;
        }
        this._advanceTurn();
    }

    private _advanceTurn(): void {
        this._turn = (this._turn + 1) % this._totalPlayers;
        this._renderAll();
        this._maybeRunAi();
    }

    private _maybeRunAi(): void {
        if (!this._gameActive || this._turn === 0) {
            return;
        }
        this.scheduleOnce(() => this._runAiTurn(), 0.7);
    }

    private _runAiTurn(): void {
        if (!this._gameActive) {
            return;
        }
        const aiIndex = this._turn;
        const mustInclude = this._isFirstTrick && this._currentCombo === null ? this._findThreeDiamondId() : null;
        const combo = this._aiChooseMove(aiIndex, mustInclude);
        if (combo === null) {
            this._commitPass(aiIndex);
        } else {
            this._commitPlay(aiIndex, combo);
        }
    }

    // ---------------------------------------------------------------------
    // AI
    // ---------------------------------------------------------------------

    private _generateCandidates(hand: number[]): Combo[] {
        const combos: Combo[] = [];

        hand.forEach((id) => {
            combos.push(detectCombo([id], this._cardData)!);
        });

        const byRank = new Map<number, number[]>();
        hand.forEach((id) => {
            const rank = this._cardData.get(id)!.rank;
            if (!byRank.has(rank)) {
                byRank.set(rank, []);
            }
            byRank.get(rank)!.push(id);
        });
        byRank.forEach((ids) => {
            if (ids.length >= 2) {
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        combos.push(detectCombo([ids[i], ids[j]], this._cardData)!);
                    }
                }
            }
            if (ids.length >= 3) {
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        for (let k = j + 1; k < ids.length; k++) {
                            combos.push(detectCombo([ids[i], ids[j], ids[k]], this._cardData)!);
                        }
                    }
                }
            }
        });

        if (hand.length >= 5) {
            combinationsOf5(hand).forEach((five) => {
                const detected = detectCombo(five, this._cardData);
                if (detected) {
                    combos.push(detected);
                }
            });
        }

        return combos;
    }

    /**
     * Simple heuristic. Following: play the fewest-cards-possible-is-moot (count is fixed by
     * the requirement), weakest sufficient beat, so strong cards get saved. Leading: prefer the
     * LARGEST combo it can form (5 > 3 > 2 > 1) so pairs/triples/straights/flushes actually get
     * used instead of the hand always being broken down into lone singles.
     */
    private _aiChooseMove(aiIndex: number, mustIncludeId: number | null): Combo | null {
        const hand = this._hands[aiIndex];
        let candidates = this._generateCandidates(hand);
        if (mustIncludeId !== null) {
            candidates = candidates.filter((c) => c.cards.includes(mustIncludeId));
        }

        const isLeading = this._currentCombo === null;
        let valid: Combo[];
        if (isLeading) {
            valid = candidates;
        } else {
            const required = this._currentCombo!;
            valid = candidates.filter((c) => c.cards.length === required.cards.length && comboBeats(c, required));
        }

        if (valid.length === 0) {
            return null;
        }
        valid.sort((a, b) => {
            if (isLeading && a.cards.length !== b.cards.length) {
                return b.cards.length - a.cards.length;
            }
            if (a.cards.length === 5 && a.kind !== b.kind) {
                return FIVE_KIND_RANK[a.kind] - FIVE_KIND_RANK[b.kind];
            }
            return a.power - b.power;
        });
        return valid[0];
    }

    // ---------------------------------------------------------------------
    // Win / result
    // ---------------------------------------------------------------------

    private _onGameEnd(winnerIndex: number): void {
        this._gameActive = false;
        this._renderAll();

        const key = leaderboardKey(this._mode!.key);
        if (winnerIndex === 0) {
            this._streak++;
        } else {
            if (this._streak > 0) {
                Leaderboard.submit(key, this._streak, false);
            }
            this._streak = 0;
        }
        this._showResult(winnerIndex);
    }

    // ---------------------------------------------------------------------
    // Top bar / table / hand / AI info
    // ---------------------------------------------------------------------

    private _buildTopBar(): void {
        const bar = createFlatRect(this.node, 'TopBar', this._designW, 70, new Color(245, 245, 240, 255));
        bar.setPosition(0, this._designH / 2 - 35, 0);
        bar.active = false;
        this._topBar = bar;

        createButton(bar, this._btnSprites, '選單', -this._designW / 2 + 60, 0, 90, 44, () => {
            this._showMenu();
        });
        createButton(bar, this._btnSprites, '重新開始', this._designW / 2 - 70, 0, 110, 44, () => {
            if (this._mode) {
                this._startGame(this._mode);
            }
        });
    }

    private _buildTable(): void {
        this._tableLayer = new Node('Table');
        this._tableLayer.parent = this.node;
        this._tableLayer.addComponent(UITransform).setContentSize(this._designW, this._designH);
        this._tableLayer.active = false;

        this._statusLabel = createLabel(this._tableLayer, '', 0, this._designH / 2 - 120, 22, new Color(255, 255, 255, 255));
    }

    private _buildHandArea(): void {
        this._handLayer = new Node('HandArea');
        this._handLayer.parent = this.node;
        this._handLayer.addComponent(UITransform).setContentSize(this._designW, this._designH);
        this._handLayer.active = false;

        this._playBtn = createButton(this._handLayer, this._btnSprites, '出牌', -90, this._handY() + this._cardH / 2 + 50, 140, 52, () => {
            this._onPlayClicked();
        });
        this._passBtn = createButton(this._handLayer, this._btnSprites, '跳過', 90, this._handY() + this._cardH / 2 + 50, 140, 52, () => {
            this._onPassClicked();
        });
    }

    private _buildAiInfo(): void {
        if (this._aiInfoLayer) {
            this._aiInfoLayer.destroy();
        }
        this._aiInfoLayer = new Node('AiInfo');
        this._aiInfoLayer.parent = this.node;
        this._aiInfoLayer.addComponent(UITransform).setContentSize(this._designW, this._designH);
        this._aiInfoLayer.active = false;

        this._aiLabels = [];
        this._aiPassLabels = [];
        this._aiPassed = new Array(this._totalPlayers - 1).fill(false);
        for (let slot = 0; slot < this._totalPlayers - 1; slot++) {
            const pos = this._aiInfoPos(slot);
            const label = createLabel(this._aiInfoLayer, `電腦 ${slot + 1}：0 張`, pos.x, pos.y, 20, new Color(255, 255, 255, 255));
            this._aiLabels.push(label);

            const passLabel = createLabel(this._aiInfoLayer, '跳過', pos.x, this._aiPassLabelY(slot), 18, new Color(230, 200, 90, 255));
            passLabel.node.active = false;
            this._aiPassLabels.push(passLabel);
        }
    }

    // ---------------------------------------------------------------------
    // Menu overlay
    // ---------------------------------------------------------------------

    private _buildMenuOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'MenuOverlay', this._designW, this._designH);
        this._menuOverlay = overlay;

        const panel = createPanel(overlay, 420, 420);
        createLabel(panel, '大老二 - 選擇人數', 0, 160, 26, new Color(30, 30, 30, 255));

        const startY = 70;
        const stepY = 80;
        MODES.forEach((mode, index) => {
            const y = startY - index * stepY;
            createButton(panel, this._btnSprites, mode.label, -60, y, 260, 52, () => {
                this._startGame(mode);
            });
            const best = Leaderboard.getScores(leaderboardKey(mode.key))[0];
            const bestText = best ? `最佳連勝：${best.value}` : '最佳：--';
            createLabel(panel, bestText, 0, y - 40, 14, new Color(90, 90, 90, 255));
        });

        createButton(panel, this._btnSprites, '玩法說明', -110, -175, 190, 44, () => {
            this._showRules();
        });
        createButton(panel, this._btnSprites, '返回遊戲選單', 130, -175, 190, 44, () => {
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
        if (this._tableLayer) {
            this._tableLayer.active = false;
        }
        if (this._handLayer) {
            this._handLayer.active = false;
        }
        if (this._aiInfoLayer) {
            this._aiInfoLayer.active = false;
        }
    }

    private _refreshMenuOverlay(): void {
        const panel = this._menuOverlay!.getChildByName('Panel')!;
        const bestLabels = panel.children.filter((n) => n.name === 'Label').slice(-MODES.length);
        bestLabels.forEach((node, index) => {
            const mode = MODES[index];
            const best = Leaderboard.getScores(leaderboardKey(mode.key))[0];
            node.getComponent(Label)!.string = best ? `最佳連勝：${best.value}` : '最佳：--';
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

        const panel = createPanel(overlay, 440, 340);
        this._resultTitleLabel = createLabel(panel, '', 0, 110, 28, new Color(30, 30, 30, 255));
        this._resultSubLabel = createLabel(panel, '', 0, 60, 18, new Color(60, 60, 60, 255));

        createButton(panel, this._btnSprites, '再玩一次', -90, -110, 160, 48, () => {
            if (this._mode) {
                this._startGame(this._mode);
            }
        });
        createButton(panel, this._btnSprites, '選單', 90, -110, 160, 48, () => {
            this._showMenu();
        });
    }

    private _showResult(winnerIndex: number): void {
        if (winnerIndex === 0) {
            this._resultTitleLabel!.string = '你獲勝了！';
            this._resultTitleLabel!.color = new Color(30, 130, 60, 255);
        } else {
            this._resultTitleLabel!.string = `電腦 ${winnerIndex} 獲勝`;
            this._resultTitleLabel!.color = new Color(190, 40, 40, 255);
        }
        this._resultSubLabel!.string = `目前連勝：${this._streak}`;
        this._resultOverlay!.active = true;
    }
}
