import {
    _decorator, Component, Node, Sprite, SpriteFrame, Label, Color, UITransform, view,
} from 'cc';
import { MineCell } from './MineCell';
import { Leaderboard, ScoreEntry } from './Leaderboard';
import { createFlatRect, createOverlayBackdrop, createPanel, createLabel, createButton, ButtonSprites } from './UiKit';
const { ccclass, property } = _decorator;

interface Difficulty {
    key: string;
    label: string;
    cols: number;
    rows: number;
    mines: number;
}

const DIFFICULTIES: Difficulty[] = [
    { key: 'easy', label: '簡單 9×9（10 顆）', cols: 9, rows: 9, mines: 10 },
    { key: 'normal', label: '普通 16×16（40 顆）', cols: 16, rows: 16, mines: 40 },
    { key: 'hard', label: '困難 30×16（99 顆）', cols: 30, rows: 16, mines: 99 },
];

const RULES_TEXT = '左鍵點擊格子可以翻開；右鍵點擊可以插上或取消旗子。\n數字代表周圍 8 格內的地雷數量。\n找出所有非地雷的格子即可獲勝，翻到地雷則遊戲結束。';

const MIN_CELL_SIZE = 12;
const MAX_CELL_SIZE = 40;

function leaderboardKey(diffKey: string): string {
    return `mine_${diffKey}`;
}

@ccclass('Mine')
export class Mine extends Component {
    @property(SpriteFrame)
    public sfBtnNormal: SpriteFrame | null = null;

    @property(SpriteFrame)
    public sfBtnPressed: SpriteFrame | null = null;

    @property(SpriteFrame)
    public sfBtnDisabled: SpriteFrame | null = null;

    @property(SpriteFrame)
    public sfRadioOff: SpriteFrame | null = null;

    @property(SpriteFrame)
    public sfRadioOn: SpriteFrame | null = null;

    /** Set by the launcher after instantiating this game; shows a "back to game menu" button when present. */
    public onExitToLauncher: (() => void) | null = null;

    private _designW = 1920;
    private _designH = 1080;

    private _topBar: Node | null = null;
    private _timerLabel: Label | null = null;
    private _flagLabel: Label | null = null;

    private _boardContainer: Node | null = null;
    private _menuOverlay: Node | null = null;
    private _rulesOverlay: Node | null = null;
    private _resultOverlay: Node | null = null;
    private _resultTitleLabel: Label | null = null;
    private _resultTimeLabel: Label | null = null;
    private _resultBoardLabel: Label | null = null;

    private _cells: MineCell[][] = [];
    private _difficulty: Difficulty | null = null;
    private _lastDifficultyKey = 'easy';
    private _mineCount = 0;
    private _revealedCount = 0;
    private _flagCount = 0;
    private _minesPlaced = false;
    private _gameActive = false;
    private _elapsed = 0;

    private get _btnSprites(): ButtonSprites {
        return { normal: this.sfBtnNormal, pressed: this.sfBtnPressed, disabled: this.sfBtnDisabled };
    }

    protected onLoad(): void {
        const visible = view.getVisibleSize();
        this._designW = visible.width;
        this._designH = visible.height;
        this.getComponent(UITransform)?.setContentSize(this._designW, this._designH);

        this._buildBackground();
        this._buildTopBar();
        this._boardContainer = new Node('Board');
        this._boardContainer.parent = this.node;
        this._boardContainer.addComponent(UITransform);

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
        this._updateTimerLabel();
    }

    // ---------------------------------------------------------------------
    // Cell input callbacks
    // ---------------------------------------------------------------------

    public onCellLeftClick(cell: MineCell): void {
        if (!this._gameActive || cell.revealed || cell.flagged) {
            return;
        }
        if (!this._minesPlaced) {
            this._placeMines(cell.row, cell.col);
            this._minesPlaced = true;
        }
        if (cell.isMine) {
            this._onLose(cell);
            return;
        }
        this._floodReveal(cell);
        this._checkWin();
    }

    public onCellRightClick(cell: MineCell): void {
        if (!this._gameActive || cell.revealed) {
            return;
        }
        cell.flagged = !cell.flagged;
        this._flagCount += cell.flagged ? 1 : -1;
        cell.refresh();
        this._updateFlagLabel();
    }

    // ---------------------------------------------------------------------
    // Board building / generation
    // ---------------------------------------------------------------------

    private _startGame(diff: Difficulty): void {
        this._difficulty = diff;
        this._lastDifficultyKey = diff.key;
        this._minesPlaced = false;
        this._revealedCount = 0;
        this._flagCount = 0;
        this._mineCount = diff.mines;
        this._elapsed = 0;
        this._gameActive = true;

        this._buildBoard(diff);
        this._updateTimerLabel();
        this._updateFlagLabel();

        this._menuOverlay!.active = false;
        this._resultOverlay!.active = false;
        this._topBar!.active = true;
        this._boardContainer!.active = true;
    }

    private _buildBoard(diff: Difficulty): void {
        this._boardContainer!.removeAllChildren();
        this._cells = [];

        const topArea = this._designH / 2 - 90;
        const bottomArea = -this._designH / 2 + 20;
        const leftArea = -this._designW / 2 + 20;
        const rightArea = this._designW / 2 - 20;
        const availW = rightArea - leftArea;
        const availH = topArea - bottomArea;

        let cellSize = Math.floor(Math.min(availW / diff.cols, availH / diff.rows));
        cellSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, cellSize));

        const boardW = cellSize * diff.cols;
        const boardH = cellSize * diff.rows;
        this._boardContainer!.setPosition(0, (topArea + bottomArea) / 2, 0);

        for (let r = 0; r < diff.rows; r++) {
            const row: MineCell[] = [];
            for (let c = 0; c < diff.cols; c++) {
                const node = new Node(`Cell_${r}_${c}`);
                node.parent = this._boardContainer!;
                const x = -boardW / 2 + cellSize / 2 + c * cellSize;
                const y = boardH / 2 - cellSize / 2 - r * cellSize;
                node.setPosition(x, y, 0);
                const cell = node.addComponent(MineCell);
                cell.setup(this, r, c, cellSize - 2);
                row.push(cell);
            }
            this._cells.push(row);
        }
    }

    private _placeMines(excludeRow: number, excludeCol: number): void {
        const diff = this._difficulty!;
        const total = diff.cols * diff.rows;
        const forbidden = excludeRow * diff.cols + excludeCol;

        const indices: number[] = [];
        for (let i = 0; i < total; i++) {
            if (i !== forbidden) {
                indices.push(i);
            }
        }
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        const mineIndices = new Set(indices.slice(0, diff.mines));

        for (let i = 0; i < total; i++) {
            const r = Math.floor(i / diff.cols);
            const c = i % diff.cols;
            this._cells[r][c].isMine = mineIndices.has(i);
        }

        for (let r = 0; r < diff.rows; r++) {
            for (let c = 0; c < diff.cols; c++) {
                if (this._cells[r][c].isMine) {
                    continue;
                }
                let count = 0;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) {
                            continue;
                        }
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < diff.rows && nc >= 0 && nc < diff.cols && this._cells[nr][nc].isMine) {
                            count++;
                        }
                    }
                }
                this._cells[r][c].adjacent = count;
            }
        }
    }

    private _floodReveal(start: MineCell): void {
        const diff = this._difficulty!;
        const queue: MineCell[] = [start];
        while (queue.length > 0) {
            const cell = queue.pop()!;
            if (cell.revealed || cell.flagged) {
                continue;
            }
            cell.revealed = true;
            this._revealedCount++;
            cell.refresh();

            if (cell.adjacent === 0 && !cell.isMine) {
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) {
                            continue;
                        }
                        const nr = cell.row + dr;
                        const nc = cell.col + dc;
                        if (nr >= 0 && nr < diff.rows && nc >= 0 && nc < diff.cols) {
                            const neighbor = this._cells[nr][nc];
                            if (!neighbor.revealed && !neighbor.flagged) {
                                queue.push(neighbor);
                            }
                        }
                    }
                }
            }
        }
    }

    private _checkWin(): void {
        const diff = this._difficulty!;
        const total = diff.cols * diff.rows;
        if (this._revealedCount === total - diff.mines) {
            this._onWin();
        }
    }

    private _onWin(): void {
        this._gameActive = false;
        for (const row of this._cells) {
            for (const cell of row) {
                if (cell.isMine && !cell.flagged) {
                    cell.flagged = true;
                    cell.refresh();
                }
            }
        }
        this._flagCount = this._mineCount;
        this._updateFlagLabel();

        const timeSec = Math.floor(this._elapsed);
        const scores = Leaderboard.submit(leaderboardKey(this._difficulty!.key), timeSec, true);
        this._showResult(true, timeSec, scores);
    }

    private _onLose(hitCell: MineCell): void {
        this._gameActive = false;
        for (const row of this._cells) {
            for (const cell of row) {
                if (!cell.revealed) {
                    cell.revealed = true;
                }
                if (cell.isMine || (cell.flagged && !cell.isMine)) {
                    cell.showEndState(hitCell);
                } else {
                    cell.refresh();
                }
            }
        }
        const timeSec = Math.floor(this._elapsed);
        this._showResult(false, timeSec, Leaderboard.getScores(leaderboardKey(this._difficulty!.key)));
    }

    private _buildBackground(): void {
        createFlatRect(this.node, 'Background', this._designW, this._designH, new Color(210, 218, 230, 255));
    }

    // ---------------------------------------------------------------------
    // Top bar
    // ---------------------------------------------------------------------

    private _buildTopBar(): void {
        const bar = createFlatRect(this.node, 'TopBar', this._designW, 70, new Color(245, 245, 240, 255));
        bar.setPosition(0, this._designH / 2 - 35, 0);
        bar.active = false;
        this._topBar = bar;

        this._timerLabel = createLabel(bar, '時間：0秒', 0, 0, 22, new Color(20, 20, 20, 255));
        this._flagLabel = createLabel(bar, '地雷：0', -160, 0, 22, new Color(20, 20, 20, 255));

        createButton(bar, this._btnSprites, '選單', -this._designW / 2 + 60, 0, 90, 44, () => {
            this._showMenu();
        });
        createButton(bar, this._btnSprites, '重新開始', this._designW / 2 - 70, 0, 110, 44, () => {
            if (this._difficulty) {
                this._startGame(this._difficulty);
            }
        });
    }

    private _updateTimerLabel(): void {
        if (this._timerLabel) {
            this._timerLabel.string = `時間：${Math.floor(this._elapsed)}秒`;
        }
    }

    private _updateFlagLabel(): void {
        if (this._flagLabel) {
            this._flagLabel.string = `地雷：${this._mineCount - this._flagCount}`;
        }
    }

    // ---------------------------------------------------------------------
    // Menu overlay (mode select)
    // ---------------------------------------------------------------------

    private _buildMenuOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'MenuOverlay', this._designW, this._designH);
        this._menuOverlay = overlay;

        const panel = createPanel(overlay, 460, 460);
        createLabel(panel, '踩地雷 - 選擇難度', 0, 180, 26, new Color(30, 30, 30, 255));

        const startY = 90;
        const stepY = 90;
        DIFFICULTIES.forEach((diff, index) => {
            const y = startY - index * stepY;
            const icon = new Node('RadioIcon');
            icon.parent = panel;
            icon.setPosition(-190, y, 0);
            const iconUiT = icon.addComponent(UITransform);
            iconUiT.setContentSize(24, 24);
            const iconSprite = icon.addComponent(Sprite);
            iconSprite.spriteFrame = diff.key === this._lastDifficultyKey ? this.sfRadioOn : this.sfRadioOff;

            createButton(panel, this._btnSprites, diff.label, 20, y, 300, 56, () => {
                this._startGame(diff);
            });

            const best = Leaderboard.getScores(leaderboardKey(diff.key))[0];
            const bestText = best ? `最佳：${best.value}秒` : '最佳：--';
            createLabel(panel, bestText, 190, y - 20, 14, new Color(90, 90, 90, 255));
        });

        createButton(panel, this._btnSprites, '玩法說明', -110, -195, 190, 44, () => {
            this._showRules();
        });
        createButton(panel, this._btnSprites, '返回遊戲選單', 130, -195, 190, 44, () => {
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
        const icons = panel.children.filter((n) => n.name === 'RadioIcon');
        icons.forEach((icon, index) => {
            const diff = DIFFICULTIES[index];
            const sprite = icon.getComponent(Sprite)!;
            sprite.spriteFrame = diff.key === this._lastDifficultyKey ? this.sfRadioOn : this.sfRadioOff;
        });
        const bestLabels = panel.children.filter((n) => n.name === 'Label').slice(-DIFFICULTIES.length);
        bestLabels.forEach((node, index) => {
            const diff = DIFFICULTIES[index];
            const best = Leaderboard.getScores(leaderboardKey(diff.key))[0];
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

        const panel = createPanel(overlay, 460, 360);
        createLabel(panel, '玩法說明', 0, 140, 26, new Color(30, 30, 30, 255));
        createLabel(panel, RULES_TEXT, 0, 30, 16, new Color(60, 60, 60, 255));

        createButton(panel, this._btnSprites, '關閉', 0, -140, 160, 48, () => {
            this._rulesOverlay!.active = false;
            this._menuOverlay!.active = true;
        });
    }

    private _showRules(): void {
        this._menuOverlay!.active = false;
        this._rulesOverlay!.active = true;
    }

    // ---------------------------------------------------------------------
    // Result overlay (win / lose + leaderboard)
    // ---------------------------------------------------------------------

    private _buildResultOverlay(): void {
        const overlay = createOverlayBackdrop(this.node, 'ResultOverlay', this._designW, this._designH);
        this._resultOverlay = overlay;
        overlay.active = false;

        const panel = createPanel(overlay, 440, 480);
        this._resultTitleLabel = createLabel(panel, '獲勝！', 0, 190, 28, new Color(30, 30, 30, 255));
        this._resultTimeLabel = createLabel(panel, '時間：0秒', 0, 145, 20, new Color(60, 60, 60, 255));
        this._resultBoardLabel = createLabel(panel, '', 0, 40, 16, new Color(70, 70, 70, 255));

        createButton(panel, this._btnSprites, '再玩一次', -100, -190, 160, 48, () => {
            if (this._difficulty) {
                this._startGame(this._difficulty);
            }
        });
        createButton(panel, this._btnSprites, '選單', 100, -190, 160, 48, () => {
            this._showMenu();
        });
    }

    private _showResult(win: boolean, timeSec: number, scores: ScoreEntry[]): void {
        this._resultTitleLabel!.string = win ? '獲勝！' : '遊戲結束';
        this._resultTitleLabel!.color = win ? new Color(30, 130, 60, 255) : new Color(190, 40, 40, 255);
        this._resultTimeLabel!.string = `時間：${timeSec}秒`;

        if (scores.length === 0) {
            this._resultBoardLabel!.string = '此難度尚無紀錄';
        } else {
            const lines = scores.map((s, i) => `${i + 1}. ${s.value}秒　（${s.date}）`);
            this._resultBoardLabel!.string = `排行榜（${this._difficulty!.label}）\n${lines.join('\n')}`;
        }

        this._resultOverlay!.active = true;
    }
}
