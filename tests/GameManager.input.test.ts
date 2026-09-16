import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { GameAction } from "../src/GameAction";
import { InputManager } from "../src/InputManager";
import { CreatureState } from "../src/sprites/Creature";

// GameMap's constructor parses level files through a loaded ResourceManager;
// these tests only need a map object with a player on it.
vi.mock("../src/GameMap", () => {
    return {
        GameMap: vi.fn().mockImplementation(function (this: any) {
            this.update = vi.fn();
            this.initialize = vi.fn();
            this.player = makeFakePlayer();
        }),
    };
});

import { GameManager, STARTING_LIVES } from "../src/GameManager";

// Mirrors the private STATE enum order in src/GameManager.ts
const LOADING = 0;
const MENU = 1;
const RUNNING = 2;

const KEY_LEFT = 37;
const KEY_UP = 38;
const KEY_RIGHT = 39;
const KEY_SPACE = 32;

function makeFakePlayer() {
    const velocity = { x: 0, y: 0 };
    return {
        getState: vi.fn(() => CreatureState.NORMAL),
        getVelocity: () => velocity,
        getMaxSpeed: () => 0.5,
        setVelocity: vi.fn((x: number, y: number) => {
            velocity.x = x;
            velocity.y = y;
        }),
        jump: vi.fn(),
    };
}

function makeGameManager(): GameManager {
    const gm = Object.create(GameManager.prototype) as GameManager;
    gm.level = 0;
    gm.lives = STARTING_LIVES;
    gm.oldState = LOADING as any;
    gm.gameState = LOADING as any;
    gm.resources = { isLoaded: () => true, getLoad: vi.fn() } as any;
    gm.settings = { setMusic: vi.fn() } as any;
    gm.inputManager = new InputManager();
    gm.moveRight = new GameAction();
    gm.moveLeft = new GameAction();
    gm.jump = new GameAction();
    // The starter bound this debug action to Up Arrow and threw Error("STOP")
    // when it was pressed. Keep it on the fixture so these tests exercise that
    // exact code path if the binding is ever reintroduced.
    (gm as any).stop = new GameAction();
    return gm;
}

describe("GameManager input bindings", () => {
    beforeAll(() => {
        // p5 key-code globals used when bindings are registered
        (globalThis as any).LEFT_ARROW = KEY_LEFT;
        (globalThis as any).UP_ARROW = KEY_UP;
        (globalThis as any).RIGHT_ARROW = KEY_RIGHT;
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("finishing loading binds Left/Right Arrow and Space and opens the menu", () => {
        const gm = makeGameManager();

        gm.update();

        const actions = gm.inputManager.actions;
        expect(actions[KEY_RIGHT]).toBe(gm.moveRight);
        expect(actions[KEY_LEFT]).toBe(gm.moveLeft);
        expect(actions[KEY_SPACE]).toBe(gm.jump);
        expect(gm.gameState).toBe(MENU);
        expect(gm.oldState).toBe(RUNNING);
    });

    it("does not bind Up Arrow to the old debug 'stop' action", () => {
        const gm = makeGameManager();

        gm.update();

        expect(Object.keys(gm.inputManager.actions)).not.toContain(String(KEY_UP));
    });

    it("pressing Up Arrow during gameplay does not crash the game loop", () => {
        const gm = makeGameManager();
        gm.update(); // Loading -> Menu
        gm.gameState = RUNNING as any;
        (globalThis as any).keyIsDown = (code: number) => code === KEY_UP;

        expect(() => {
            gm.update();
            gm.update();
        }).not.toThrow();
        expect(gm.gameState).toBe(RUNNING);
    });

    it("holding Right Arrow moves the player right at max speed", () => {
        const gm = makeGameManager();
        gm.update();
        gm.gameState = RUNNING as any;
        (globalThis as any).keyIsDown = (code: number) => code === KEY_RIGHT;

        gm.update();

        expect(gm.map.player.getVelocity().x).toBe(0.5);
    });

    it("holding Left Arrow moves the player left at max speed", () => {
        const gm = makeGameManager();
        gm.update();
        gm.gameState = RUNNING as any;
        (globalThis as any).keyIsDown = (code: number) => code === KEY_LEFT;

        gm.update();

        expect(gm.map.player.getVelocity().x).toBe(-0.5);
    });

    it("pressing Space asks the player to jump", () => {
        const gm = makeGameManager();
        gm.update();
        gm.gameState = RUNNING as any;
        (globalThis as any).keyIsDown = (code: number) => code === KEY_SPACE;

        gm.update();

        expect(gm.map.player.jump).toHaveBeenCalledWith(false);
    });
});
