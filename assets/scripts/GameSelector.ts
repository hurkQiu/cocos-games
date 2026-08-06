import { _decorator, Component, Node, Prefab, SpriteFrame, Color, UITransform, instantiate, view } from 'cc';
import { Mine } from './Mine';
import { Snake } from './Snake';
import { Solitaire } from './Solitaire';
import { Blackjack } from './Blackjack';
import { Pyramid } from './Pyramid';
import { BigTwo } from './BigTwo';
import { Spider } from './Spider';
import { createFlatRect, createPanel, createLabel, createButton, ButtonSprites } from './UiKit';
const { ccclass, property } = _decorator;

@ccclass('GameSelector')
export class GameSelector extends Component {
    @property(SpriteFrame)
    public sfBtnNormal: SpriteFrame | null = null;

    @property(SpriteFrame)
    public sfBtnPressed: SpriteFrame | null = null;

    @property(SpriteFrame)
    public sfBtnDisabled: SpriteFrame | null = null;

    @property(Prefab)
    public minesweeperPrefab: Prefab | null = null;

    @property(Prefab)
    public snakePrefab: Prefab | null = null;

    @property(Prefab)
    public solitairePrefab: Prefab | null = null;

    @property(Prefab)
    public blackjackPrefab: Prefab | null = null;

    @property(Prefab)
    public pyramidPrefab: Prefab | null = null;

    @property(Prefab)
    public bigTwoPrefab: Prefab | null = null;

    @property(Prefab)
    public spiderPrefab: Prefab | null = null;

    private _designW = 1920;
    private _designH = 1080;
    private _selectorRoot: Node | null = null;
    private _gameNode: Node | null = null;

    private get _btnSprites(): ButtonSprites {
        return { normal: this.sfBtnNormal, pressed: this.sfBtnPressed, disabled: this.sfBtnDisabled };
    }

    protected onLoad(): void {
        const visible = view.getVisibleSize();
        this._designW = visible.width;
        this._designH = visible.height;
        this._buildSelector();
    }

    private _buildSelector(): void {
        const root = new Node('Selector');
        root.parent = this.node;
        root.addComponent(UITransform).setContentSize(this._designW, this._designH);
        this._selectorRoot = root;

        createFlatRect(root, 'Background', this._designW, this._designH, new Color(210, 218, 230, 255));

        const panel = createPanel(root, 420, 740);
        createLabel(panel, '選擇遊戲', 0, 320, 28, new Color(30, 30, 30, 255));

        createButton(panel, this._btnSprites, '踩地雷', 0, 230, 280, 60, () => {
            this._launch(this.minesweeperPrefab);
        });
        createButton(panel, this._btnSprites, '貪吃蛇', 0, 150, 280, 60, () => {
            this._launch(this.snakePrefab);
        });
        createButton(panel, this._btnSprites, '接龍', 0, 70, 280, 60, () => {
            this._launch(this.solitairePrefab);
        });
        createButton(panel, this._btnSprites, '21點', 0, -10, 280, 60, () => {
            this._launch(this.blackjackPrefab);
        });
        createButton(panel, this._btnSprites, '金字塔接龍', 0, -90, 280, 60, () => {
            this._launch(this.pyramidPrefab);
        });
        createButton(panel, this._btnSprites, '大老二', 0, -170, 280, 60, () => {
            this._launch(this.bigTwoPrefab);
        });
        createButton(panel, this._btnSprites, '蜘蛛接龍', 0, -250, 280, 60, () => {
            this._launch(this.spiderPrefab);
        });
    }

    private _launch(prefab: Prefab | null): void {
        if (!prefab) {
            return;
        }
        this._selectorRoot!.active = false;

        const node = instantiate(prefab);
        node.parent = this.node;
        const gameUiT = node.getComponent(UITransform);
        if (gameUiT) {
            gameUiT.setContentSize(this._designW, this._designH);
        }
        this._gameNode = node;

        const mine = node.getComponent(Mine);
        if (mine) {
            mine.onExitToLauncher = () => this._backToSelector();
        }
        const snake = node.getComponent(Snake);
        if (snake) {
            snake.onExitToLauncher = () => this._backToSelector();
        }
        const solitaire = node.getComponent(Solitaire);
        if (solitaire) {
            solitaire.onExitToLauncher = () => this._backToSelector();
        }
        const blackjack = node.getComponent(Blackjack);
        if (blackjack) {
            blackjack.onExitToLauncher = () => this._backToSelector();
        }
        const pyramid = node.getComponent(Pyramid);
        if (pyramid) {
            pyramid.onExitToLauncher = () => this._backToSelector();
        }
        const bigTwo = node.getComponent(BigTwo);
        if (bigTwo) {
            bigTwo.onExitToLauncher = () => this._backToSelector();
        }
        const spider = node.getComponent(Spider);
        if (spider) {
            spider.onExitToLauncher = () => this._backToSelector();
        }
    }

    private _backToSelector(): void {
        if (this._gameNode) {
            this._gameNode.destroy();
            this._gameNode = null;
        }
        this._selectorRoot!.active = true;
    }
}
