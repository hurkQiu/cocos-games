import {
    _decorator, Component, Node, Graphics, SpriteFrame, Label, Color, UITransform,
    input, Input, KeyCode, EventKeyboard, view,
} from 'cc';
import { Leaderboard, ScoreEntry } from './Leaderboard';
import { createFlatRect, createOverlayBackdrop, createPanel, createLabel, createButton, ButtonSprites } from './UiKit';
const { ccclass, property } = _decorator;

interface SpeedTier {
    key: string;
    label: string;
    tickInterval: number;
}

const SPEEDS: SpeedTier[] = [
    { key: 'slow', label: '慢速', tickInterval: 0.18 },
    { key: 'normal', label: '普通', tickInterval: 0.12 },
    { key: 'fast', label: '快速', tickInterval: 0.08 },
];

const RULES_TEXT = '使用方向鍵或 WASD 控制蛇的移動方向。\n吃到食物可以增長身體並加分。\n撞到牆壁或自己的身體則遊戲結束。';

const COLS = 20;
const ROWS = 20;
const MIN_CELL_SIZE = 12;
const MAX_CELL_SIZE = 32;

interface Vec2i {
    row: number;
    col: number;
}

const DIR_UP: Vec2i = { row: -1, col: 0 };
const DIR_DOWN: Vec2i = { row: 1, col: 0 };
const DIR_LEFT: Vec2i = { row: 0, col: -1 };
const DIR_RIGHT: Vec2i = { row: 0, col: 1 };

function leaderboardKey(speedKey: string): string {
    return `snake_${speedKey}`;
}

@ccclass('Snake')
export class Snake extends Component {
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
    private _cellSize = 20;

    private _topBar: Node | null = null;
    private _scoreLabel: Label | null = null;
    private _timeLabel: Label | null = null;

    private _boardContainer: Node | null = null;
    private _menuOverlay: Node | null = null;
    private _rulesOverlay: Node | null = null;
    private _resultOverlay: Node | null = null;
    private _resultTitleLabel: Label | null = null;
    private _resultScoreLabel: Label | null = null;
    private _resultBoardLabel: Label | null = null;

    private _segmentNodes: Node[] = [];
    private _foodNode: Node | null = null;
    private _body: Vec2i[] = [];
    private _food: Vec2i = { row: 0, col: 0 };
    private _dir: Vec2i = DIR_RIGHT;
    private _nextDir: Vec2i = DIR_RIGHT;

    private _speed: SpeedTier | null = null;
    private _tickTimer = 0;
    private _score = 0;
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

        const topArea = this._designH / 2 - 90;
        const bottomArea = -this._designH / 2 + 20;
        const availW = this._designW - 40;
        const availH = topArea - bottomArea;
        this._cellSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, Math.floor(Math.min(availW / COLS, availH / ROWS))));

        createFlatRect(this.node, 'Background', this._designW, this._designH, new Color(210, 218, 230, 255));

        this._buildTopBar();
        this._boardContainer = new Node('Board');
        this._boardContainer.parent = this.node;
        this._boardContainer.addComponent(UITransform).setContentSize(this._cellSize * COLS, this._cellSize * ROWS);
        this._boardContainer.setPosition(0, (topArea + bottomArea) / 2, 0);
        this._buildBoardFrame();

        this._buildMenuOverlay();
        this._buildRulesOverlay();
        this._buildResultOverlay();

        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);

        this._showMenu();
    }

    protected onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
    }

    protected update(dt: number): void {
        if (!this._gameActive) {
            return;
        }
        this._elapsed += dt;
        this._updateTimeLabel();

        this._tickTimer += dt;
        if (this._tickTimer >= this._speed!.tickInterval) {
            this._tickTimer -= this._speed!.tickInterval;
            this._step();
        }
    }

    // ---------------------------------------------------------------------
    // Input
    // ---------------------------------------------------------------------

    private _onKeyDown(e: EventKeyboard): void {
        if (!this._gameActive) {
            return;
        }
        let dir: Vec2i | null = null;
        switch (e.keyCode) {
        case KeyCode.KEY_W:
        case KeyCode.ARROW_UP:
            dir = DIR_UP;
            break;
        case KeyCode.KEY_S:
        case KeyCode.ARROW_DOWN:
            dir = DIR_DOWN;
            break;
        case KeyCode.KEY_A:
        case KeyCode.ARROW_LEFT:
            dir = DIR_LEFT;
            break;
        case KeyCode.KEY_D:
        case KeyCode.ARROW_RIGHT:
            dir = DIR_RIGHT;
            break;
        default:
            return;
        }
        const opposite = dir.row === -this._dir.row && dir.col === -this._dir.col;
        if (!opposite) {
            this._nextDir = dir;
        }
    }

    // ---------------------------------------------------------------------
    // Game loop
    // ---------------------------------------------------------------------

    private _startGame(speed: SpeedTier): void {
        this._speed = speed;
        this._score = 0;
        this._elapsed = 0;
        this._tickTimer = 0;
        this._gameActive = true;

        const midRow = Math.floor(ROWS / 2);
        const midCol = Math.floor(COLS / 2);
        this._body = [
            { row: midRow, col: midCol },
            { row: midRow, col: midCol - 1 },
            { row: midRow, col: midCol - 2 },
        ];
        this._dir = DIR_RIGHT;
        this._nextDir = DIR_RIGHT;

        this._boardContainer!.removeAllChildren();
        this._segmentNodes = [];
        this._foodNode = null;
        this._spawnFood();
        this._renderBody();

        this._updateScoreLabel();
        this._updateTimeLabel();

        this._menuOverlay!.active = false;
        this._resultOverlay!.active = false;
        this._topBar!.active = true;
        this._boardContainer!.active = true;
    }

    private _step(): void {
        this._dir = this._nextDir;
        const head = this._body[0];
        const newHead: Vec2i = { row: head.row + this._dir.row, col: head.col + this._dir.col };

        if (newHead.row < 0 || newHead.row >= ROWS || newHead.col < 0 || newHead.col >= COLS) {
            this._onGameOver();
            return;
        }

        const eating = newHead.row === this._food.row && newHead.col === this._food.col;
        const bodyToCheck = eating ? this._body : this._body.slice(0, -1);
        if (bodyToCheck.some((seg) => seg.row === newHead.row && seg.col === newHead.col)) {
            this._onGameOver();
            return;
        }

        this._body.unshift(newHead);
        if (eating) {
            this._score++;
            this._updateScoreLabel();
            this._spawnFood();
        } else {
            this._body.pop();
        }
        this._renderBody();
    }

    private _onGameOver(): void {
        this._gameActive = false;
        const scoreVal = this._score;
        const timeSec = Math.floor(this._elapsed);
        const scores = Leaderboard.submit(leaderboardKey(this._speed!.key), scoreVal, false);
        this._showResult(scoreVal, timeSec, scores);
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    private _gridToPos(cell: Vec2i): { x: number; y: number } {
        const boardW = this._cellSize * COLS;
        const boardH = this._cellSize * ROWS;
        return {
            x: -boardW / 2 + this._cellSize / 2 + cell.col * this._cellSize,
            y: boardH / 2 - this._cellSize / 2 - cell.row * this._cellSize,
        };
    }

    /** Draws the static grid (full-span horizontal + vertical lines) and the bounding outline once. */
    private _buildBoardFrame(): void {
        const boardW = this._cellSize * COLS;
        const boardH = this._cellSize * ROWS;
        const gfx = this._boardContainer!.addComponent(Graphics);

        gfx.fillColor = new Color(222, 228, 236, 255);
        gfx.rect(-boardW / 2, -boardH / 2, boardW, boardH);
        gfx.fill();

        // Grid lines drawn as thin filled rects rather than stroked open
        // paths: stroke() reliably renders closed rect() paths (see the
        // border below) but does not render open 2-point moveTo/lineTo
        // paths in this engine build, so rect()+fill() is used instead.
        const lineThickness = 1;
        gfx.fillColor = Color.BLACK;
        for (let c = 0; c <= COLS; c++) {
            const x = -boardW / 2 + c * this._cellSize;
            gfx.rect(x - lineThickness / 2, -boardH / 2, lineThickness, boardH);
        }
        for (let r = 0; r <= ROWS; r++) {
            const y = -boardH / 2 + r * this._cellSize;
            gfx.rect(-boardW / 2, y - lineThickness / 2, boardW, lineThickness);
        }
        gfx.fill();

        gfx.lineWidth = 3;
        gfx.strokeColor = Color.BLACK;
        gfx.rect(-boardW / 2, -boardH / 2, boardW, boardH);
        gfx.stroke();
    }

    private _segmentNode(index: number): Node {
        while (this._segmentNodes.length <= index) {
            const node = createFlatRect(
                this._boardContainer!,
                `Seg_${this._segmentNodes.length}`,
                this._cellSize - 2,
                this._cellSize - 2,
                new Color(90, 175, 110, 255),
            );
            this._segmentNodes.push(node);
        }
        return this._segmentNodes[index];
    }

    private _renderBody(): void {
        const size = this._cellSize - 2;
        for (let i = 0; i < this._body.length; i++) {
            const node = this._segmentNode(i);
            node.active = true;
            const gfx = node.getComponent(Graphics)!;
            gfx.clear();
            gfx.fillColor = i === 0 ? new Color(40, 110, 60, 255) : new Color(90, 175, 110, 255);
            gfx.rect(-size / 2, -size / 2, size, size);
            gfx.fill();
            const pos = this._gridToPos(this._body[i]);
            node.setPosition(pos.x, pos.y, 0);
        }
        for (let i = this._body.length; i < this._segmentNodes.length; i++) {
            this._segmentNodes[i].active = false;
        }
    }

    private _spawnFood(): void {
        if (!this._foodNode) {
            this._foodNode = createFlatRect(this._boardContainer!, 'Food', this._cellSize - 4, this._cellSize - 4, new Color(220, 70, 60, 255));
        }
        let attempts = 0;
        let candidate: Vec2i;
        do {
            candidate = { row: Math.floor(Math.random() * ROWS), col: Math.floor(Math.random() * COLS) };
            attempts++;
        } while (attempts < 200 && this._body.some((seg) => seg.row === candidate.row && seg.col === candidate.col));
        this._food = candidate;
        const pos = this._gridToPos(this._food);
        this._foodNode.setPosition(pos.x, pos.y, 0);
    }

    // ---------------------------------------------------------------------
    // Top bar
    // ---------------------------------------------------------------------

    private _buildTopBar(): void {
        const bar = createFlatRect(this.node, 'TopBar', this._designW, 70, new Color(245, 245, 240, 255));
        bar.setPosition(0, this._designH / 2 - 35, 0);
        bar.active = false;
        this._topBar = bar;

        this._scoreLabel = createLabel(bar, '分數：0', 0, 0, 22, new Color(20, 20, 20, 255));
        this._timeLabel = createLabel(bar, '時間：0秒', -160, 0, 22, new Color(20, 20, 20, 255));

        createButton(bar, this._btnSprites, '選單', -this._designW / 2 + 60, 0, 90, 44, () => {
            this._showMenu();
        });
        createButton(bar, this._btnSprites, '重新開始', this._designW / 2 - 70, 0, 110, 44, () => {
            if (this._speed) {
                this._startGame(this._speed);
            }
        });
    }

    private _updateScoreLabel(): void {
        if (this._scoreLabel) {
            this._scoreLabel.string = `分數：${this._score}`;
        }
    }

    private _updateTimeLabel(): void {
        if (this._timeLabel) {
            this._timeLabel.string = `時間：${Math.floor(this._elapsed)}秒`;
        }
    }

    // ---------------------------------------------------------------------
    // Menu overlay (speed select)
    // ---------------------------------------------------------------------

    private _buildMenuOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'MenuOverlay', this._designW, this._designH);
        this._menuOverlay = overlay;

        const panel = createPanel(overlay, 420, 420);
        createLabel(panel, '貪吃蛇 - 選擇速度', 0, 150, 26, new Color(30, 30, 30, 255));

        const startY = 70;
        const stepY = 80;
        SPEEDS.forEach((speed, index) => {
            const y = startY - index * stepY;
            createButton(panel, this._btnSprites, speed.label, -60, y, 220, 52, () => {
                this._startGame(speed);
            });
            const best = Leaderboard.getScores(leaderboardKey(speed.key))[0];
            const bestText = best ? `最佳：${best.value}` : '最佳：--';
            createLabel(panel, bestText, 140, y, 14, new Color(90, 90, 90, 255));
        });

        createButton(panel, this._btnSprites, '玩法說明', -110, -170, 190, 44, () => {
            this._showRules();
        });
        createButton(panel, this._btnSprites, '返回遊戲選單', 130, -170, 190, 44, () => {
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
        this._boardContainer!.active = false;
    }

    private _refreshMenuOverlay(): void {
        const panel = this._menuOverlay!.getChildByName('Panel')!;
        const bestLabels = panel.children.filter((n) => n.name === 'Label').slice(-SPEEDS.length);
        bestLabels.forEach((node, index) => {
            const speed = SPEEDS[index];
            const best = Leaderboard.getScores(leaderboardKey(speed.key))[0];
            const label = node.getComponent(Label)!;
            label.string = best ? `最佳：${best.value}` : '最佳：--';
        });
    }

    // ---------------------------------------------------------------------
    // Rules overlay
    // ---------------------------------------------------------------------

    private _buildRulesOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'RulesOverlay', this._designW, this._designH);
        this._rulesOverlay = overlay;
        overlay.active = false;

        const panel = createPanel(overlay, 460, 340);
        createLabel(panel, '玩法說明', 0, 130, 26, new Color(30, 30, 30, 255));
        createLabel(panel, RULES_TEXT, 0, 30, 16, new Color(60, 60, 60, 255));

        createButton(panel, this._btnSprites, '關閉', 0, -130, 160, 48, () => {
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

        const panel = createPanel(overlay, 440, 480);
        this._resultTitleLabel = createLabel(panel, '遊戲結束', 0, 190, 28, new Color(190, 40, 40, 255));
        this._resultScoreLabel = createLabel(panel, '分數：0', 0, 145, 20, new Color(60, 60, 60, 255));
        this._resultBoardLabel = createLabel(panel, '', 0, 40, 16, new Color(70, 70, 70, 255));

        createButton(panel, this._btnSprites, '再玩一次', -100, -190, 160, 48, () => {
            if (this._speed) {
                this._startGame(this._speed);
            }
        });
        createButton(panel, this._btnSprites, '選單', 100, -190, 160, 48, () => {
            this._showMenu();
        });
    }

    private _showResult(score: number, timeSec: number, scores: ScoreEntry[]): void {
        this._resultTitleLabel!.string = '遊戲結束';
        this._resultScoreLabel!.string = `分數：${score}　時間：${timeSec}秒`;

        if (scores.length === 0) {
            this._resultBoardLabel!.string = '此速度尚無紀錄';
        } else {
            const lines = scores.map((s, i) => `${i + 1}. ${s.value}　（${s.date}）`);
            this._resultBoardLabel!.string = `排行榜（${this._speed!.label}）\n${lines.join('\n')}`;
        }

        this._resultOverlay!.active = true;
    }
}
