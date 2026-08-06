import { sys } from 'cc';

export interface ScoreEntry {
    value: number;
    date: string;
}

const STORAGE_KEY = 'game_center_leaderboard_v1';
const MAX_ENTRIES = 5;

/**
 * Persists best scores per game/mode using sys.localStorage, which Cocos backs
 * with a real on-disk store on native platforms and the browser's local
 * storage in web/preview builds — the closest cross-platform equivalent to a
 * local save file. Shared across every game (each game picks its own key,
 * e.g. "mine_easy" or "snake_fast").
 */
export class Leaderboard {
    private static _cache: Record<string, ScoreEntry[]> | null = null;

    private static _loadAll(): Record<string, ScoreEntry[]> {
        if (Leaderboard._cache) {
            return Leaderboard._cache;
        }
        let data: Record<string, ScoreEntry[]> = {};
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            if (raw) {
                data = JSON.parse(raw);
            }
        } catch (e) {
            data = {};
        }
        Leaderboard._cache = data;
        return data;
    }

    private static _saveAll(data: Record<string, ScoreEntry[]>): void {
        Leaderboard._cache = data;
        try {
            sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            // storage unavailable (e.g. disabled by browser) - fail silently
        }
    }

    public static getScores(key: string): ScoreEntry[] {
        const data = Leaderboard._loadAll();
        return data[key] ? data[key].slice() : [];
    }

    /**
     * Records a completed value and returns the updated top list for that key.
     * @param ascending true for "lower is better" (e.g. clear time), false for "higher is better" (e.g. score).
     */
    public static submit(key: string, value: number, ascending: boolean): ScoreEntry[] {
        const data = Leaderboard._loadAll();
        const list = data[key] ? data[key].slice() : [];
        list.push({ value, date: new Date().toLocaleString() });
        list.sort((a, b) => (ascending ? a.value - b.value : b.value - a.value));
        list.length = Math.min(list.length, MAX_ENTRIES);
        data[key] = list;
        Leaderboard._saveAll(data);
        return list;
    }
}
