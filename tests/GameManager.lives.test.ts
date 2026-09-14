import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameAction } from "../src/GameAction";
import { CreatureState } from "../src/sprites/Creature";

// GameMap does heavy work in its constructor (parsing level files, building
// sprites, etc.) which requires a fully loaded ResourceManager. GameManager
// only needs to know that `new GameMap(...)` was called with the right args,
// so replace it with a lightweight stand-in.
vi.mock("../src/GameMap", () => {
    return {
        GameMap: vi.fn().mockImplementation(function (this: any) {
            this.initialize = vi.fn();
        }),
    };
});

import { GameManager, STARTING_LIVES } from "../src/GameManager";
import { GameMap } from "../src/GameMap";

// GameManager.STATE is a private, unexported enum. Its declaration order in
// src/GameManager.ts (Loading, Menu, Running, Finished) is mirrored here so
// tests can drive/observe gameState without reaching into private members.
const LOADING = 0;
const MENU = 1;
const RUNNING = 2;
const FINISHED = 3;

function makeFakePlayer(state: CreatureState) {
    return {
        getState: vi.fn(() => state),
        getVelocity: () => ({ x: 0, y: 0 }),
        getMaxSpeed: () => 1,
        setVelocity: vi.fn(),
        jump: vi.fn(),
    };
}

function makeFakeMap(playerState: CreatureState) {
    return {
        update: vi.fn(),
        initialize: vi.fn(),
        player: makeFakePlayer(playerState),
    };
}

// Builds a GameManager without running its real constructor, which would
// otherwise instantiate ResourceManager/Settings and reach for p5 globals
// (loadJSON, createDiv, ...) that aren't available in this test environment.
function makeGameManager(overrides: Partial<GameManager> = {}): GameManager {
    const gm = Object.create(GameManager.prototype) as GameManager;
    gm.level = 0;
    gm.lives = STARTING_LIVES;
    gm.oldState = RUNNING as any;
    gm.gameState = RUNNING as any;
    gm.resources = {} as any;
    gm.settings = {} as any;
    gm.inputManager = { checkInput: vi.fn() } as any;
    gm.moveRight = new GameAction();
    gm.moveLeft = new GameAction();
    gm.jump = new GameAction();
    gm.stop = new GameAction();
    gm.map = makeFakeMap(CreatureState.NORMAL) as any;
    Object.assign(gm, overrides);
    return gm;
}

describe("GameManager lives / game-over system", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("update() while Running", () => {
        it("player death with lives remaining: loses a life and restarts the level", () => {
            const map = makeFakeMap(CreatureState.DEAD);
            const gm = makeGameManager({ lives: 3, gameState: RUNNING as any, map: map as any });

            gm.update();

            expect(gm.lives).toBe(2);
            expect(map.initialize).toHaveBeenCalledTimes(1);
            expect(gm.gameState).toBe(RUNNING);
            expect(gm.isGameOver()).toBe(false);
        });

        it("decrements lives by exactly one per death, even with several lives left", () => {
            const map = makeFakeMap(CreatureState.DEAD);
            const gm = makeGameManager({ lives: 3, gameState: RUNNING as any, map: map as any });

            gm.update();

            expect(gm.lives).toBe(2);
            expect(gm.lives).not.toBe(0);
        });

        it("player alive (NORMAL): lives and level state are untouched", () => {
            const map = makeFakeMap(CreatureState.NORMAL);
            const gm = makeGameManager({ lives: 3, gameState: RUNNING as any, map: map as any });

            gm.update();

            expect(gm.lives).toBe(3);
            expect(map.initialize).not.toHaveBeenCalled();
            expect(gm.gameState).toBe(RUNNING);
        });

        it("death on the last life (lives=1) transitions to game-over without restarting the level", () => {
            const map = makeFakeMap(CreatureState.DEAD);
            const gm = makeGameManager({ lives: 1, gameState: RUNNING as any, map: map as any });

            gm.update();

            expect(gm.lives).toBe(0);
            expect(map.initialize).not.toHaveBeenCalled();
            expect(gm.gameState).toBe(FINISHED);
            expect(gm.isGameOver()).toBe(true);
        });

        it("does not go below zero lives on repeated deaths once finished", () => {
            const map = makeFakeMap(CreatureState.DEAD);
            const gm = makeGameManager({ lives: 1, gameState: RUNNING as any, map: map as any });

            gm.update();
            expect(gm.gameState).toBe(FINISHED);

            // Once Finished, update() no longer touches the map/lives logic.
            gm.update();
            expect(gm.lives).toBe(0);
        });
    });

    describe("isGameOver()", () => {
        it("returns false for every non-Finished state", () => {
            expect(makeGameManager({ gameState: LOADING as any }).isGameOver()).toBe(false);
            expect(makeGameManager({ gameState: MENU as any }).isGameOver()).toBe(false);
            expect(makeGameManager({ gameState: RUNNING as any }).isGameOver()).toBe(false);
        });

        it("returns true only once gameState is Finished", () => {
            expect(makeGameManager({ gameState: FINISHED as any }).isGameOver()).toBe(true);
        });
    });

    describe("restartGame()", () => {
        it("resets lives to STARTING_LIVES, level to 0, and gameState to Menu", () => {
            const gm = makeGameManager({
                lives: 0,
                level: 3,
                gameState: FINISHED as any,
                oldState: FINISHED as any,
            });

            gm.restartGame();

            expect(gm.lives).toBe(STARTING_LIVES);
            expect(gm.level).toBe(0);
            expect(gm.gameState).toBe(MENU);
            expect(gm.oldState).toBe(RUNNING);
            expect(gm.isGameOver()).toBe(false);
        });

        it("builds a fresh GameMap for the reset level using the existing resources/settings", () => {
            const gm = makeGameManager({ lives: 0, level: 3, gameState: FINISHED as any });
            const previousMap = gm.map;

            gm.restartGame();

            expect(GameMap).toHaveBeenCalledWith(0, gm.resources, gm.settings);
            expect(gm.map).not.toBe(previousMap);
        });

        it("can be called again after a subsequent game-over (full loop)", () => {
            const map = makeFakeMap(CreatureState.DEAD);
            const gm = makeGameManager({ lives: 1, gameState: RUNNING as any, map: map as any });

            gm.update(); // dies -> Finished
            expect(gm.isGameOver()).toBe(true);

            gm.restartGame();
            expect(gm.lives).toBe(STARTING_LIVES);
            expect(gm.level).toBe(0);
            expect(gm.isGameOver()).toBe(false);
        });
    });
});
