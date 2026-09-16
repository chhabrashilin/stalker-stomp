/**
 * Tracks the player's score for one playthrough, plus the best score ever reached,
 * which is saved between sessions.
 *
 * The score is banked as a checkpoint whenever a level is cleared. Dying rolls the
 * score back to that checkpoint: the level's collectibles respawn when it restarts,
 * so without the rollback a player could farm points by dying on purpose.
 */

export interface ScoreStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const POINTS = {
    STAR: 100,
    MUSIC: 250,
    GEM: 500,
    STOMP: 200,
    LEVEL_CLEAR: 1000,
};

//each stomp in a chain (without touching the ground) doubles, up to this multiplier
export const MAX_STOMP_MULTIPLIER = 8;

export const HIGH_SCORE_KEY = "side-scroller.highScore";

export class ScoreKeeper {
    score: number;
    checkpoint: number; //score banked at the start of the current level
    highScore: number;
    beatHighScore: boolean; //true once this playthrough has set a new best
    stompChain: number; //stomps since the player last landed
    storage: ScoreStorage;

    constructor(storage: ScoreStorage = defaultStorage()) {
        this.storage = storage;
        this.score = 0;
        this.checkpoint = 0;
        this.beatHighScore = false;
        this.stompChain = 0;
        this.highScore = this.loadHighScore();
    }

    /**
     * Adds points to the score, updating and saving the high score if it was beaten.
     * Returns the number of points awarded so callers can display them.
     */
    add(points: number): number {
        this.score += points;
        if (this.score > this.highScore) {
            this.highScore = this.score;
            this.beatHighScore = true;
            this.saveHighScore();
        }
        return points;
    }

    collectStar(): number {
        return this.add(POINTS.STAR);
    }

    collectMusic(): number {
        return this.add(POINTS.MUSIC);
    }

    collectGem(): number {
        return this.add(POINTS.GEM);
    }

    /**
     * Awards a stomp, doubling for each enemy killed since the player last
     * landed. Tougher enemies pass a larger base, which the chain then scales.
     */
    stomp(base: number = POINTS.STOMP): number {
        const multiplier = Math.min(Math.pow(2, this.stompChain), MAX_STOMP_MULTIPLIER);
        this.stompChain++;
        return this.add(base * multiplier);
    }

    land() {
        this.stompChain = 0;
    }

    clearLevel(): number {
        const points = this.add(POINTS.LEVEL_CLEAR);
        this.checkpoint = this.score;
        this.stompChain = 0;
        return points;
    }

    restartLevel() {
        this.score = this.checkpoint;
        this.stompChain = 0;
    }

    loadHighScore(): number {
        try {
            const saved = Number(this.storage.getItem(HIGH_SCORE_KEY));
            return Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
        } catch (e) {
            console.warn("Unable to load high score:", e);
            return 0;
        }
    }

    saveHighScore() {
        try {
            this.storage.setItem(HIGH_SCORE_KEY, String(this.highScore));
        } catch (e) {
            console.warn("Unable to save high score:", e);
        }
    }
}

/**
 * The browser's localStorage when it is usable, otherwise an in-memory stand-in
 * (localStorage is missing outside browsers and can throw when site data is blocked).
 */
export function defaultStorage(): ScoreStorage {
    try {
        const ls = (globalThis as { localStorage?: ScoreStorage }).localStorage;
        if (ls) {
            return ls;
        }
    } catch (e) {
        console.warn("localStorage unavailable, high score will not be saved:", e);
    }
    return memoryStorage();
}

export function memoryStorage(): ScoreStorage {
    const values: { [key: string]: string } = {};
    return {
        getItem: (key) => (key in values ? values[key] : null),
        setItem: (key, value) => {
            values[key] = value;
        },
    };
}
