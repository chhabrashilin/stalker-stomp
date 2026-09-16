import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    ScoreKeeper,
    ScoreStorage,
    POINTS,
    MAX_STOMP_MULTIPLIER,
    HIGH_SCORE_KEY,
    memoryStorage,
    defaultStorage,
} from "../src/ScoreKeeper";

describe("ScoreKeeper", () => {
    let storage: ScoreStorage;
    let score: ScoreKeeper;

    beforeEach(() => {
        storage = memoryStorage();
        score = new ScoreKeeper(storage);
    });

    describe("collecting items", () => {
        it("starts a playthrough at zero", () => {
            expect(score.score).toBe(0);
            expect(score.highScore).toBe(0);
            expect(score.beatHighScore).toBe(false);
        });

        it("awards different points for stars, music notes, and gems", () => {
            expect(score.collectStar()).toBe(POINTS.STAR);
            expect(score.collectMusic()).toBe(POINTS.MUSIC);
            expect(score.collectGem()).toBe(POINTS.GEM);
            expect(score.score).toBe(POINTS.STAR + POINTS.MUSIC + POINTS.GEM);
        });

        it("rarer collectibles are worth more", () => {
            expect(POINTS.MUSIC).toBeGreaterThan(POINTS.STAR);
            expect(POINTS.GEM).toBeGreaterThan(POINTS.MUSIC);
        });
    });

    describe("stomp chains", () => {
        it("doubles the reward for each stomp before landing", () => {
            expect(score.stomp()).toBe(POINTS.STOMP);
            expect(score.stomp()).toBe(POINTS.STOMP * 2);
            expect(score.stomp()).toBe(POINTS.STOMP * 4);
            expect(score.score).toBe(POINTS.STOMP * 7);
        });

        it("caps the chain multiplier", () => {
            const rewards = [];
            for (let i = 0; i < 6; i++) rewards.push(score.stomp());
            expect(Math.max(...rewards)).toBe(POINTS.STOMP * MAX_STOMP_MULTIPLIER);
            expect(rewards[5]).toBe(POINTS.STOMP * MAX_STOMP_MULTIPLIER);
        });

        it("landing resets the chain back to the base reward", () => {
            score.stomp();
            score.stomp();
            score.land();
            expect(score.stomp()).toBe(POINTS.STOMP);
        });
    });

    describe("level checkpoints", () => {
        it("dying rolls back points earned since the level started", () => {
            score.collectStar();
            score.stomp();

            score.restartLevel();

            expect(score.score).toBe(0);
        });

        it("clearing a level awards a bonus and banks the score", () => {
            score.collectStar();
            expect(score.clearLevel()).toBe(POINTS.LEVEL_CLEAR);
            const banked = score.score;

            score.collectGem();
            score.restartLevel();

            expect(banked).toBe(POINTS.STAR + POINTS.LEVEL_CLEAR);
            expect(score.score).toBe(banked);
        });

        it("restarting a level also resets a stomp chain in progress", () => {
            score.stomp();
            score.stomp();
            score.restartLevel();
            expect(score.stomp()).toBe(POINTS.STOMP);
        });

        it("repeatedly dying cannot be used to farm points", () => {
            for (let attempt = 0; attempt < 3; attempt++) {
                score.collectStar();
                score.collectMusic();
                score.restartLevel();
            }
            score.collectStar();
            score.collectMusic();
            expect(score.score).toBe(POINTS.STAR + POINTS.MUSIC);
        });
    });

    describe("high score", () => {
        it("tracks and saves a new best as soon as the score passes it", () => {
            score.collectGem();
            expect(score.highScore).toBe(POINTS.GEM);
            expect(score.beatHighScore).toBe(true);
            expect(storage.getItem(HIGH_SCORE_KEY)).toBe(String(POINTS.GEM));
        });

        it("loads the saved best score in a later session", () => {
            storage.setItem(HIGH_SCORE_KEY, "1234");
            const later = new ScoreKeeper(storage);
            expect(later.highScore).toBe(1234);
            expect(later.score).toBe(0);
        });

        it("does not claim a new best until the saved one is exceeded", () => {
            storage.setItem(HIGH_SCORE_KEY, String(POINTS.GEM));
            const later = new ScoreKeeper(storage);

            later.collectGem(); // ties the best
            expect(later.beatHighScore).toBe(false);
            expect(later.highScore).toBe(POINTS.GEM);

            later.collectStar(); // passes it
            expect(later.beatHighScore).toBe(true);
            expect(later.highScore).toBe(POINTS.GEM + POINTS.STAR);
        });

        it("keeps the best score even after dying rolls the current score back", () => {
            score.collectGem();
            score.restartLevel();
            expect(score.score).toBe(0);
            expect(score.highScore).toBe(POINTS.GEM);
        });

        it("ignores corrupt saved values", () => {
            for (const bad of ["not a number", "-50", "Infinity", ""]) {
                storage.setItem(HIGH_SCORE_KEY, bad);
                expect(new ScoreKeeper(storage).highScore).toBe(0);
            }
        });

        it("keeps scoring when storage throws (e.g. blocked site data)", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const broken: ScoreStorage = {
                getItem: () => {
                    throw new Error("blocked");
                },
                setItem: () => {
                    throw new Error("blocked");
                },
            };

            const keeper = new ScoreKeeper(broken);
            expect(keeper.highScore).toBe(0);
            expect(() => keeper.collectStar()).not.toThrow();
            expect(keeper.score).toBe(POINTS.STAR);
            expect(keeper.highScore).toBe(POINTS.STAR);
            warn.mockRestore();
        });
    });

    describe("defaultStorage()", () => {
        it("falls back to working in-memory storage when localStorage is missing", () => {
            const fallback = defaultStorage();
            fallback.setItem("k", "v");
            expect(fallback.getItem("k")).toBe("v");
            expect(fallback.getItem("missing")).toBeNull();
        });

        it("uses localStorage when the browser provides it", () => {
            const fake = memoryStorage();
            (globalThis as any).localStorage = fake;
            try {
                expect(defaultStorage()).toBe(fake);
            } finally {
                delete (globalThis as any).localStorage;
            }
        });
    });
});
