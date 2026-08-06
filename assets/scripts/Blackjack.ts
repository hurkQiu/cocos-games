import {
    _decorator, Component, Node, Prefab, SpriteFrame, Label, Color, UITransform, instantiate, view,
} from 'cc';
import { PokerCard, Suit } from './PokerCard';
import { Leaderboard } from './Leaderboard';
import { createFlatRect, createOverlayBackdrop, createPanel, createLabel, createWrappedLabel, createButton, ButtonSprites } from './UiKit';
const { ccclass, property } = _decorator;

const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const RULES_TEXT = '莊家與玩家各發兩張牌，玩家的牌都翻開，莊家則有一張蓋牌。玩家可以選擇「要牌」或「停牌」，點數超過 21 即爆牌落敗。\n\n'
    + '玩家停牌後換莊家行動，莊家必須補牌到點數 17 以上才會停止。雙方都沒有爆牌時，點數較大的一方獲勝，點數相同則平手。\n\n'
    + 'A 可以算 1 點或 11 點（以不爆牌為優先），J、Q、K 都算 10 點。連續獲勝的場次會累計連勝紀錄，落敗後歸零並存入排行榜。';

const LEADERBOARD_KEY = 'blackjack_streak';

type Outcome = 'win' | 'lose' | 'push';

interface HandCard {
    rank: number;
    suit: Suit;
}

@ccclass('Blackjack')
export class Blackjack extends Component {
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
    private _cardW = 100;
    private _cardH = 140;
    private _dealerY = 150;
    private _playerY = -150;

    private _topBar: Node | null = null;
    private _streakLabel: Label | null = null;
    private _menuOverlay: Node | null = null;
    private _rulesOverlay: Node | null = null;
    private _resultOverlay: Node | null = null;
    private _resultTitleLabel: Label | null = null;
    private _resultSubLabel: Label | null = null;
    private _resultBoardLabel: Label | null = null;

    private _tableLayer: Node | null = null;
    private _dealerLabel: Label | null = null;
    private _playerLabel: Label | null = null;
    private _hitBtn: Node | null = null;
    private _standBtn: Node | null = null;

    private _deck: HandCard[] = [];
    private _dealerHand: HandCard[] = [];
    private _playerHand: HandCard[] = [];
    private _dealerNodes: Node[] = [];
    private _playerNodes: Node[] = [];

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
        this._dealerY = this._designH / 2 - 190;
        this._playerY = -(this._designH / 2 - 190);

        createFlatRect(this.node, 'Background', this._designW, this._designH, new Color(20, 90, 55, 255));

        this._buildTopBar();
        this._buildTable();
        this._buildMenuOverlay();
        this._buildRulesOverlay();
        this._buildResultOverlay();

        this._showMenu();
    }

    // ---------------------------------------------------------------------
    // Game flow
    // ---------------------------------------------------------------------

    private _startSession(): void {
        this._streak = 0;
        this._updateStreakLabel();
        this._dealRound();
    }

    private _dealRound(): void {
        this._gameActive = true;
        this._buildDeck();
        this._dealerHand = [this._draw(), this._draw()];
        this._playerHand = [this._draw(), this._draw()];

        this._menuOverlay!.active = false;
        this._resultOverlay!.active = false;
        this._topBar!.active = true;
        this._tableLayer!.active = true;
        this._setActionButtonsVisible(true);

        this._renderHands(false);

        if (this._handValue(this._playerHand) === 21) {
            this._stand();
        }
    }

    private _buildDeck(): void {
        this._deck = [];
        for (let s = 0; s < 4; s++) {
            for (let r = 1; r <= 13; r++) {
                this._deck.push({ rank: r, suit: s as Suit });
            }
        }
        for (let i = this._deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this._deck[i], this._deck[j]] = [this._deck[j], this._deck[i]];
        }
    }

    private _draw(): HandCard {
        return this._deck.pop()!;
    }

    private _handValue(hand: HandCard[]): number {
        let total = 0;
        let aces = 0;
        for (const c of hand) {
            if (c.rank === 1) {
                aces++;
                total += 11;
            } else {
                total += Math.min(c.rank, 10);
            }
        }
        while (total > 21 && aces > 0) {
            total -= 10;
            aces--;
        }
        return total;
    }

    private _hit(): void {
        if (!this._gameActive) {
            return;
        }
        this._playerHand.push(this._draw());
        const val = this._handValue(this._playerHand);
        if (val > 21) {
            this._gameActive = false;
            this._renderHands(true);
            this._finishRound('lose');
            return;
        }
        this._renderHands(false);
        if (val === 21) {
            this._stand();
        }
    }

    private _stand(): void {
        if (!this._gameActive) {
            return;
        }
        this._gameActive = false;
        while (this._handValue(this._dealerHand) < 17) {
            this._dealerHand.push(this._draw());
        }
        this._renderHands(true);

        const playerVal = this._handValue(this._playerHand);
        const dealerVal = this._handValue(this._dealerHand);
        if (dealerVal > 21 || playerVal > dealerVal) {
            this._finishRound('win');
        } else if (playerVal < dealerVal) {
            this._finishRound('lose');
        } else {
            this._finishRound('push');
        }
    }

    private _finishRound(outcome: Outcome): void {
        this._setActionButtonsVisible(false);
        if (outcome === 'win') {
            this._streak++;
        } else if (outcome === 'lose') {
            if (this._streak > 0) {
                Leaderboard.submit(LEADERBOARD_KEY, this._streak, false);
            }
            this._streak = 0;
        }
        this._updateStreakLabel();
        this._showResult(outcome);
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    private _renderHands(dealerRevealed: boolean): void {
        this._dealerNodes.forEach((n) => n.destroy());
        this._playerNodes.forEach((n) => n.destroy());
        this._dealerNodes = [];
        this._playerNodes = [];

        const spacing = this._cardW * 0.55;

        this._dealerHand.forEach((card, i) => {
            const node = instantiate(this.cardPrefab!);
            node.parent = this._tableLayer!;
            const pc = node.getComponent(PokerCard)!;
            pc.resize(this._cardW, this._cardH);
            pc.setCard(RANK_LABELS[card.rank], card.suit);
            pc.setFaceUp(dealerRevealed || i !== 1);
            const x = (i - (this._dealerHand.length - 1) / 2) * spacing;
            node.setPosition(x, this._dealerY, 0);
            this._dealerNodes.push(node);
        });

        this._playerHand.forEach((card, i) => {
            const node = instantiate(this.cardPrefab!);
            node.parent = this._tableLayer!;
            const pc = node.getComponent(PokerCard)!;
            pc.resize(this._cardW, this._cardH);
            pc.setCard(RANK_LABELS[card.rank], card.suit);
            pc.setFaceUp(true);
            const x = (i - (this._playerHand.length - 1) / 2) * spacing;
            node.setPosition(x, this._playerY, 0);
            this._playerNodes.push(node);
        });

        this._updateTotals(dealerRevealed);
    }

    private _updateTotals(dealerRevealed: boolean): void {
        this._playerLabel!.string = `玩家：${this._handValue(this._playerHand)}`;
        if (dealerRevealed) {
            this._dealerLabel!.string = `莊家：${this._handValue(this._dealerHand)}`;
        } else {
            const visible = this._dealerHand.length > 0 ? this._handValue([this._dealerHand[0]]) : 0;
            this._dealerLabel!.string = `莊家：${visible} + ？`;
        }
    }

    private _setActionButtonsVisible(visible: boolean): void {
        if (this._hitBtn) {
            this._hitBtn.active = visible;
        }
        if (this._standBtn) {
            this._standBtn.active = visible;
        }
    }

    // ---------------------------------------------------------------------
    // Top bar / table
    // ---------------------------------------------------------------------

    private _buildTopBar(): void {
        const bar = createFlatRect(this.node, 'TopBar', this._designW, 70, new Color(245, 245, 240, 255));
        bar.setPosition(0, this._designH / 2 - 35, 0);
        bar.active = false;
        this._topBar = bar;

        this._streakLabel = createLabel(bar, '連勝：0', 0, 0, 22, new Color(20, 20, 20, 255));

        createButton(bar, this._btnSprites, '選單', -this._designW / 2 + 60, 0, 90, 44, () => {
            this._showMenu();
        });
        createButton(bar, this._btnSprites, '重新開始', this._designW / 2 - 70, 0, 110, 44, () => {
            this._dealRound();
        });
    }

    private _updateStreakLabel(): void {
        if (this._streakLabel) {
            this._streakLabel.string = `連勝：${this._streak}`;
        }
    }

    private _buildTable(): void {
        this._tableLayer = new Node('Table');
        this._tableLayer.parent = this.node;
        this._tableLayer.addComponent(UITransform).setContentSize(this._designW, this._designH);
        this._tableLayer.active = false;

        this._dealerLabel = createLabel(this._tableLayer, '莊家：0', 0, this._dealerY + this._cardH / 2 + 30, 22, new Color(255, 255, 255, 255));
        this._playerLabel = createLabel(this._tableLayer, '玩家：0', 0, this._playerY + this._cardH / 2 + 30, 22, new Color(255, 255, 255, 255));

        this._hitBtn = createButton(this._tableLayer, this._btnSprites, '要牌', -90, 0, 140, 52, () => {
            this._hit();
        });
        this._standBtn = createButton(this._tableLayer, this._btnSprites, '停牌', 90, 0, 140, 52, () => {
            this._stand();
        });
    }

    // ---------------------------------------------------------------------
    // Menu overlay
    // ---------------------------------------------------------------------

    private _buildMenuOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'MenuOverlay', this._designW, this._designH);
        this._menuOverlay = overlay;

        const panel = createPanel(overlay, 400, 340);
        createLabel(panel, '21點', 0, 120, 28, new Color(30, 30, 30, 255));

        createButton(panel, this._btnSprites, '開始遊戲', 0, 40, 220, 56, () => {
            this._startSession();
        });

        const best = Leaderboard.getScores(LEADERBOARD_KEY)[0];
        createLabel(panel, best ? `最佳連勝：${best.value}` : '最佳連勝：--', 0, -30, 16, new Color(90, 90, 90, 255));

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
        if (this._tableLayer) {
            this._tableLayer.active = false;
        }
    }

    private _refreshMenuOverlay(): void {
        const panel = this._menuOverlay!.getChildByName('Panel')!;
        const labels = panel.children.filter((n) => n.name === 'Label');
        const bestLabelNode = labels[labels.length - 1];
        const best = Leaderboard.getScores(LEADERBOARD_KEY)[0];
        bestLabelNode.getComponent(Label)!.string = best ? `最佳連勝：${best.value}` : '最佳連勝：--';
    }

    // ---------------------------------------------------------------------
    // Rules overlay
    // ---------------------------------------------------------------------

    private _buildRulesOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'RulesOverlay', this._designW, this._designH);
        this._rulesOverlay = overlay;
        overlay.active = false;

        const panel = createPanel(overlay, 560, 420);
        createLabel(panel, '玩法說明', 0, 175, 26, new Color(30, 30, 30, 255));
        createWrappedLabel(panel, RULES_TEXT, 0, 135, 480, 15, new Color(60, 60, 60, 255));

        createButton(panel, this._btnSprites, '關閉', 0, -175, 160, 48, () => {
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

        const panel = createPanel(overlay, 420, 380);
        this._resultTitleLabel = createLabel(panel, '', 0, 140, 28, new Color(30, 30, 30, 255));
        this._resultSubLabel = createLabel(panel, '', 0, 95, 18, new Color(60, 60, 60, 255));
        this._resultBoardLabel = createLabel(panel, '', 0, 20, 16, new Color(70, 70, 70, 255));

        createButton(panel, this._btnSprites, '再玩一次', -90, -140, 160, 48, () => {
            this._dealRound();
        });
        createButton(panel, this._btnSprites, '選單', 90, -140, 160, 48, () => {
            this._showMenu();
        });
    }

    private _showResult(outcome: Outcome): void {
        const titleMap: Record<Outcome, string> = { win: '獲勝！', lose: '落敗', push: '平手' };
        const colorMap: Record<Outcome, Color> = {
            win: new Color(30, 130, 60, 255),
            lose: new Color(190, 40, 40, 255),
            push: new Color(150, 120, 30, 255),
        };
        this._resultTitleLabel!.string = titleMap[outcome];
        this._resultTitleLabel!.color = colorMap[outcome];
        this._resultSubLabel!.string = `目前連勝：${this._streak}`;

        const scores = Leaderboard.getScores(LEADERBOARD_KEY);
        if (scores.length === 0) {
            this._resultBoardLabel!.string = '尚無最佳連勝紀錄';
        } else {
            const lines = scores.map((s, i) => `${i + 1}. ${s.value} 連勝　（${s.date}）`);
            this._resultBoardLabel!.string = `最佳連勝排行榜\n${lines.join('\n')}`;
        }

        this._resultOverlay!.active = true;
    }
}
