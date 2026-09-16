import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { GameMap, POPUP_LIFETIME } from "../src/GameMap";
import { GameManager } from "../src/GameManager";
import { ScoreKeeper, POINTS, memoryStorage } from "../src/ScoreKeeper";
import { Player } from "../src/sprites/Player";
import { Creature, CreatureState, Grub } from "../src/sprites/Creature";
import { Heart, Music, PowerUp, Star } from "../src/sprites/PowerUp";
import { Sprite } from "../src/sprites/Sprite";

// Gives a sprite a real single-frame animation for each name so getImage(),
// clone(), and setVelocity()'s animation switching all behave as in the game.
function withFrames<T extends Sprite>(sprite: T, w: number, h: number, ...anims: string[]): T {
    for (const name of ["default", ...anims]) {
        if (name !== "default") sprite.addAnimation(name);
        sprite.addFrame(name, { width: w, height: h } as any, 100);
    }
    return sprite;
}

// A tiny level: player, a star, and a grub standing on a floor.
const LEVEL = ["# test level", "0  o  1", "BBBBBBB"];

function makeResources() {
    const lookup: { [key: string]: any } = {
        TILE_SIZE: 64,
        mappings: { "0": "player", o: "star", "1": "grub" },
        levels: ["level1"],
        B: { width: 64, height: 64 },
        player: withFrames(new Player(), 80, 64, "left", "right"),
        star: withFrames(new Star(), 64, 64),
        grub: withFrames(new Grub(), 64, 48, "left", "right"),
    };
    const sound = { play: vi.fn() };
    return {
        get: (name: string) => lookup[name],
        getLoad: (name: string) => (name === "level1" ? LEVEL : sound),
    } as any;
}

// Builds a GameMap around a real ScoreKeeper without parsing a level.
function makeBareMap(): GameMap {
    const map = Object.create(GameMap.prototype) as GameMap;
    map.score = new ScoreKeeper(memoryStorage());
    map.popups = [];
    map.sprites = [];
    map.level = 0;
    map.settings = { playEvents: false } as any;
    map.initialize = vi.fn();
    map.player = withFrames(new Player(), 80, 64, "left", "right");
    return map;
}

function stubP5Drawing() {
    const g = globalThis as any;
    for (const fn of ["image", "push", "pop", "fill", "stroke", "strokeWeight", "textSize"]) {
        g[fn] = vi.fn();
    }
    g.textAlign = vi.fn();
    g.text = vi.fn();
    Object.assign(g, { LEFT: "left", RIGHT: "right", TOP: "top", CENTER: "center" });
    Object.assign(g, { BOTTOM: "bottom" });
}

function drawnText(): string[] {
    return (globalThis as any).text.mock.calls.map((call: any[]) => String(call[0]));
}

describe("GameMap score integration", () => {
    beforeAll(() => {
        stubP5Drawing();
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("collecting power-ups", () => {
        it("a star awards star points, leaves the map, and floats a +points label", () => {
            const map = makeBareMap();
            const star = withFrames(new Star(), 64, 64);
            star.setPosition(100, 200);
            map.sprites.push(star);

            map.acquirePowerUp(star);

            expect(map.score.score).toBe(POINTS.STAR);
            expect(map.sprites).not.toContain(star);
            expect(map.popups).toHaveLength(1);
            expect(map.popups[0]).toMatchObject({ x: 132, y: 200, text: `+${POINTS.STAR}` });
        });

        it("a music note awards music points", () => {
            const map = makeBareMap();
            map.acquirePowerUp(withFrames(new Music(), 64, 64));
            expect(map.score.score).toBe(POINTS.MUSIC);
        });

        it("a generic power-up is a gem worth gem points", () => {
            const map = makeBareMap();
            map.acquirePowerUp(withFrames(new PowerUp(), 48, 48));
            expect(map.score.score).toBe(POINTS.GEM);
        });

        it("plays the prize sound for scoring pickups only when event sounds are on", () => {
            const map = makeBareMap();
            map.prize = { play: vi.fn() } as any;

            map.acquirePowerUp(withFrames(new Star(), 64, 64));
            expect(map.prize.play).not.toHaveBeenCalled();

            map.settings = { playEvents: true } as any;
            map.acquirePowerUp(withFrames(new Music(), 64, 64));
            expect(map.prize.play).toHaveBeenCalledTimes(1);
        });

        it("reaching the goal awards the level bonus, banks it, and loads the next level", () => {
            const map = makeBareMap();
            map.score.collectStar();

            map.acquirePowerUp(withFrames(new Heart(), 64, 64));

            expect(map.level).toBe(1);
            expect(map.initialize).toHaveBeenCalledTimes(1);
            expect(map.score.score).toBe(POINTS.STAR + POINTS.LEVEL_CLEAR);
            expect(map.score.checkpoint).toBe(POINTS.STAR + POINTS.LEVEL_CLEAR);
            expect(map.popups.map((p) => p.text)).toContain(`Level clear! +${POINTS.LEVEL_CLEAR}`);
        });
    });

    describe("enemy collisions", () => {
        function enemyAt(map: GameMap): Creature {
            const grub = withFrames(new Grub(), 64, 48, "left", "right");
            grub.setPosition(0, 100);
            map.sprites.push(grub);
            map.getSpriteCollision = () => (grub.getState() === CreatureState.NORMAL ? grub : null);
            return grub;
        }

        it("stomping enemies in one jump doubles the reward each time", () => {
            const map = makeBareMap();

            const first = enemyAt(map);
            map.checkPlayerCollision(map.player, true);
            const second = enemyAt(map);
            map.checkPlayerCollision(map.player, true);

            expect(first.getState()).toBe(CreatureState.DYING);
            expect(second.getState()).toBe(CreatureState.DYING);
            expect(map.score.score).toBe(POINTS.STOMP + POINTS.STOMP * 2);
            expect(map.popups.map((p) => p.text)).toEqual([
                `+${POINTS.STOMP}`,
                `+${POINTS.STOMP * 2}`,
            ]);
        });

        it("running into an enemy from the side hurts the player and scores nothing", () => {
            const map = makeBareMap();
            const grub = enemyAt(map);

            map.checkPlayerCollision(map.player, false);

            expect(map.player.getState()).toBe(CreatureState.DYING);
            expect(grub.getState()).toBe(CreatureState.NORMAL);
            expect(map.score.score).toBe(0);
        });

        it("landing on the ground between stomps restarts the chain", () => {
            const map = makeBareMap();
            map.updateSprite = vi.fn();

            enemyAt(map);
            map.checkPlayerCollision(map.player, true);
            map.player.onGround = true;
            map.update();
            enemyAt(map);
            map.checkPlayerCollision(map.player, true);

            expect(map.score.score).toBe(POINTS.STOMP * 2);
        });

        it("staying airborne keeps the chain going across frames", () => {
            const map = makeBareMap();
            map.updateSprite = vi.fn();

            enemyAt(map);
            map.checkPlayerCollision(map.player, true);
            map.update(); // stomp bounced the player, so onGround is false
            enemyAt(map);
            map.checkPlayerCollision(map.player, true);

            expect(map.score.score).toBe(POINTS.STOMP + POINTS.STOMP * 2);
        });
    });

    describe("score popups", () => {
        it("rise while they age and disappear after their lifetime", () => {
            const map = makeBareMap();
            map.showPoints(map.player, 100);
            const startY = map.popups[0].y;

            map.updatePopups(POPUP_LIFETIME / 2);
            expect(map.popups).toHaveLength(1);
            expect(map.popups[0].y).toBeLessThan(startY);

            map.updatePopups(POPUP_LIFETIME / 2);
            expect(map.popups).toHaveLength(0);
        });
    });

    describe("with a parsed level", () => {
        it("keeps the score across a level restart but rolls back that attempt's points", () => {
            const map = new GameMap(0, makeResources(), { playEvents: false } as any);
            map.score = new ScoreKeeper(memoryStorage());
            const star = map.sprites.find((s) => s instanceof Star) as Star;

            map.acquirePowerUp(star);
            expect(map.score.score).toBe(POINTS.STAR);

            map.initialize(); // what GameManager does after the player dies
            expect(map.score.score).toBe(0);
            expect(map.sprites.some((s) => s instanceof Star)).toBe(true);
            expect(map.popups).toHaveLength(0);
        });

        it("the score object survives initialize() so progress carries between levels", () => {
            const map = new GameMap(0, makeResources(), { playEvents: false } as any);
            const keeper = map.score;
            map.initialize();
            expect(map.score).toBe(keeper);
        });

        it("draws Lives, Score, and Best in the HUD", () => {
            const map = new GameMap(0, makeResources(), { playEvents: false } as any);
            map.score = new ScoreKeeper(memoryStorage());
            map.score.collectMusic();

            map.draw(2);

            const texts = drawnText();
            expect(texts).toContain("Lives: 2");
            expect(texts).toContain(`Score: ${POINTS.MUSIC}`);
            expect(texts).toContain(`Best: ${POINTS.MUSIC}`);
        });
    });
});

describe("GameManager Game Over screen", () => {
    const FINISHED = 3;

    beforeAll(() => {
        stubP5Drawing();
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    function finishedGame(score: ScoreKeeper): GameManager {
        const gm = Object.create(GameManager.prototype) as GameManager;
        gm.gameState = FINISHED as any;
        gm.map = { score } as any;
        return gm;
    }

    it("shows the final score and the saved best", () => {
        const storage = memoryStorage();
        storage.setItem("side-scroller.highScore", "9000");
        const score = new ScoreKeeper(storage);
        score.collectGem();

        finishedGame(score).draw();

        const texts = drawnText();
        expect(texts).toContain("Game Over");
        expect(texts).toContain(`Final score: ${POINTS.GEM}`);
        expect(texts).toContain("Best: 9000");
        expect(texts).not.toContain("New high score!");
    });

    it("celebrates a new high score", () => {
        const score = new ScoreKeeper(memoryStorage());
        score.collectGem();

        finishedGame(score).draw();

        expect(drawnText()).toContain("New high score!");
    });
});
