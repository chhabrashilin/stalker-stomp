import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { CreatureState, Fly, Grub, StompResult } from "../src/sprites/Creature";
import { assignTargets } from "../src/GameMap";
import { Star } from "../src/sprites/PowerUp";
import {
    Stalker,
    StalkerPhase,
    ALERT_TIME,
    BLOCK_GRACE_TIME,
    CHARGE_SPEED,
    CHARGE_TIME,
    DETECT_X,
    DETECT_Y,
    PATROL_SPEED,
    STALKER_STOMP_VALUE,
    STUN_TIME,
    TURN_BLIND_TIME,
} from "../src/sprites/Stalker";

const TILE = 64;

// A Stalker in the game always has these four animations; setVelocity() and
// setState() switch between them, so a bare sprite would leave currAnimation
// undefined and the next update() would throw.
function makeStalker(): Stalker {
    const stalker = new Stalker();
    const names = [
        "left",
        "right",
        "alertLeft",
        "alertRight",
        "stunnedLeft",
        "stunnedRight",
        "deadLeft",
        "deadRight",
    ];
    for (const name of names) {
        stalker.addAnimation(name);
        stalker.addFrame(name, { width: 64, height: 64 } as any, 100);
    }
    return stalker;
}

// Stands in for the player. The Stalker only ever reads a target's position.
function targetAt(x: number, y: number) {
    return { getPosition: () => ({ x, y }) } as any;
}

// One frame: GameMap.draw() calls wakeUp() on every on-screen creature, and
// GameMap.update() calls update(). Ticking both keeps the on-screen flag set
// the way it is for a visible sprite in the running game.
function tick(stalker: Stalker, elapsed: number) {
    stalker.wakeUp();
    stalker.update(elapsed);
}

// Drives the Stalker until it leaves the phase it is in, so a test can say
// "charge until it ends" without hard-coding the number of frames.
function tickUntilPhaseChanges(stalker: Stalker, step = 16, limit = 500) {
    const from = stalker.phase;
    for (let i = 0; i < limit && stalker.phase === from; i++) {
        tick(stalker, step);
    }
}

describe("Stalker", () => {
    let stalker: Stalker;

    beforeEach(() => {
        stalker = makeStalker();
    });

    describe("construction and cloning", () => {
        it("starts patrolling, facing left, at grub speed and subject to gravity", () => {
            expect(stalker.phase).toBe(StalkerPhase.PATROL);
            expect(stalker.phaseTime).toBe(0);
            expect(stalker.facing).toBe(-1);
            expect(stalker.getMaxSpeed()).toBe(PATROL_SPEED);
            expect(stalker.isFlying()).toBe(false);
            expect(stalker.getState()).toBe(CreatureState.NORMAL);
        });

        it("clone() carries the fields Sprite.clone() would otherwise drop", () => {
            stalker.enterPhase(StalkerPhase.CHARGE);
            stalker.phaseTime = 123;
            stalker.facing = 1;
            stalker.turnBlindTime = 200;
            stalker.blockGraceTime = 50;

            const copy = stalker.clone() as Stalker;

            expect(copy.phase).toBe(StalkerPhase.CHARGE);
            expect(copy.phaseTime).toBe(123);
            expect(copy.facing).toBe(1);
            expect(copy.turnBlindTime).toBe(200);
            expect(copy.blockGraceTime).toBe(50);
        });

        it("a clone of an untargeted prototype has no target of its own", () => {
            // GameMap clones the ResourceManager prototype, which never has a
            // target; assignTargets() is what supplies one after parsing.
            expect(stalker.getTarget()).toBeFalsy();
            expect((stalker.clone() as Stalker).getTarget()).toBeFalsy();
        });
    });

    describe("a missing target is loud, not silent", () => {
        let error: any;

        beforeEach(() => {
            error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        });

        // spyOn hands back the existing spy when console.error is already
        // mocked, so without this the call counts leak between tests.
        afterEach(() => {
            error.mockRestore();
        });

        it("reports the problem instead of quietly doing nothing", () => {
            expect(() => tick(stalker, 16)).not.toThrow();
            expect(error).toHaveBeenCalledTimes(1);
            expect(String(error.mock.calls[0][0])).toContain("assignTargets");
        });

        it("reports it once, not once per frame", () => {
            for (let i = 0; i < 60; i++) tick(stalker, 16);
            expect(error).toHaveBeenCalledTimes(1);
        });

        it("degrades to ordinary patrolling rather than freezing", () => {
            tick(stalker, 16);
            expect(stalker.phase).toBe(StalkerPhase.PATROL);
            expect(stalker.getVelocity().x).toBe(-PATROL_SPEED);
        });
    });

    describe("detection", () => {
        beforeEach(() => {
            stalker.setPosition(500, 100);
            stalker.wakeUp(); // on screen
        });

        it("notices a player in front, in range, on the same level", () => {
            stalker.setTarget(targetAt(500 - 3 * TILE, 100));
            expect(stalker.canDetect()).toBe(true);
        });

        it("ignores a player behind it, so it can be approached from that side", () => {
            stalker.setTarget(targetAt(500 + 3 * TILE, 100));
            expect(stalker.canDetect()).toBe(false);
        });

        it("ignores a player further away than its detection range", () => {
            stalker.setTarget(targetAt(500 - (DETECT_X + 1), 100));
            expect(stalker.canDetect()).toBe(false);
        });

        it("ignores a player on a different level", () => {
            stalker.setTarget(targetAt(500 - 2 * TILE, 100 + DETECT_Y + 1));
            expect(stalker.canDetect()).toBe(false);
        });

        it("does not hunt while off screen", () => {
            stalker.setTarget(targetAt(500 - 3 * TILE, 100));
            stalker.update(16); // clears the on-screen flag, and no draw sets it again
            expect(stalker.canDetect()).toBe(false);
        });

        it("cannot notice the player in the moment just after turning round", () => {
            stalker.setTarget(targetAt(500 - 3 * TILE, 100));
            stalker.turnBlindTime = TURN_BLIND_TIME;
            expect(stalker.canDetect()).toBe(false);
        });
    });

    describe("wakeUp() does not trample the state machine", () => {
        it("still starts a patrolling Stalker moving, as it does any creature", () => {
            expect(stalker.getVelocity().x).toBe(0);
            stalker.wakeUp();
            expect(stalker.getVelocity().x).toBe(-PATROL_SPEED);
        });

        it("leaves the deliberate standstill of the tell alone", () => {
            stalker.enterPhase(StalkerPhase.ALERT);
            stalker.wakeUp();
            expect(stalker.getVelocity().x).toBe(0);
        });

        it("leaves the deliberate standstill of the stun alone", () => {
            stalker.enterPhase(StalkerPhase.STUNNED);
            stalker.wakeUp();
            expect(stalker.getVelocity().x).toBe(0);
        });
    });

    describe("phase machine", () => {
        beforeEach(() => {
            stalker.setPosition(500, 100);
            stalker.setTarget(targetAt(500 - 3 * TILE, 100));
        });

        it("stops to telegraph the attack when it spots the player", () => {
            tick(stalker, 16);
            expect(stalker.phase).toBe(StalkerPhase.ALERT);
            expect(stalker.getVelocity().x).toBe(0);
        });

        it("holds the tell for its full duration before committing", () => {
            tick(stalker, 16); // -> ALERT
            tick(stalker, ALERT_TIME);
            expect(stalker.phase).toBe(StalkerPhase.ALERT);
            expect(stalker.getVelocity().x).toBe(0);

            tick(stalker, 1);
            expect(stalker.phase).toBe(StalkerPhase.CHARGE);
        });

        it("charges at charge speed, in the direction it is facing", () => {
            tick(stalker, 16);
            tick(stalker, ALERT_TIME + 1);
            expect(stalker.phase).toBe(StalkerPhase.CHARGE);
            expect(Math.abs(stalker.getVelocity().x)).toBe(CHARGE_SPEED);
            expect(Math.sign(stalker.getVelocity().x)).toBe(stalker.facing);
        });

        it("a charge that hits nothing still ends, leaving it stunned", () => {
            tick(stalker, 16);
            tick(stalker, ALERT_TIME + 1);
            tick(stalker, CHARGE_TIME);
            expect(stalker.phase).toBe(StalkerPhase.CHARGE);

            tick(stalker, 1);
            expect(stalker.phase).toBe(StalkerPhase.STUNNED);
            expect(stalker.getVelocity().x).toBe(0);
        });

        it("a charge into a wall stops dead instead of bouncing back", () => {
            tick(stalker, 16);
            tick(stalker, ALERT_TIME + 1);
            const chargeVelocity = stalker.getVelocity().x;

            stalker.collideHorizontal();

            expect(stalker.phase).toBe(StalkerPhase.STUNNED);
            expect(stalker.getVelocity().x).toBe(0);
            expect(stalker.getVelocity().x).not.toBe(-chargeVelocity);
        });

        it("a patrolling Stalker still bounces off walls and turns round", () => {
            stalker.wakeUp();
            expect(stalker.getVelocity().x).toBe(-PATROL_SPEED);

            stalker.collideHorizontal();

            expect(stalker.phase).toBe(StalkerPhase.PATROL);
            expect(stalker.getVelocity().x).toBe(PATROL_SPEED);
            expect(stalker.facing).toBe(1);
            expect(stalker.turnBlindTime).toBe(TURN_BLIND_TIME);
        });

        it("resumes patrolling the way it faces, not always to the left", () => {
            stalker.facing = 1;
            stalker.enterPhase(StalkerPhase.STUNNED);
            tick(stalker, STUN_TIME);
            expect(stalker.phase).toBe(StalkerPhase.STUNNED);

            tick(stalker, 1);
            expect(stalker.phase).toBe(StalkerPhase.PATROL);
            expect(stalker.getVelocity().x).toBe(PATROL_SPEED);
        });

        it("runs the whole cycle and returns to patrolling", () => {
            const seen = [stalker.phase];
            for (let i = 0; i < 4; i++) {
                tickUntilPhaseChanges(stalker);
                seen.push(stalker.phase);
            }
            expect(seen).toEqual([
                StalkerPhase.PATROL,
                StalkerPhase.ALERT,
                StalkerPhase.CHARGE,
                StalkerPhase.STUNNED,
                StalkerPhase.PATROL,
            ]);
        });
    });

    describe("tuning holds together", () => {
        it("a charge covers exactly five tiles", () => {
            expect(CHARGE_SPEED * CHARGE_TIME).toBe(5 * TILE);
        });

        it("detection reach is shorter than charge reach, so a runner escapes", () => {
            expect(DETECT_X).toBeLessThan(CHARGE_SPEED * CHARGE_TIME);
        });

        it("turning round can never lead to an instant charge", () => {
            expect(TURN_BLIND_TIME + ALERT_TIME).toBe(700);
        });
    });

    describe("player contact", () => {
        it("can be stomped while stunned", () => {
            stalker.enterPhase(StalkerPhase.STUNNED);
            expect(stalker.resolvePlayerContact(true)).toBe(StompResult.KILLS_CREATURE);
        });

        it("shrugs off a stomp in every other phase", () => {
            for (const phase of [StalkerPhase.PATROL, StalkerPhase.ALERT, StalkerPhase.CHARGE]) {
                const s = makeStalker();
                s.enterPhase(phase);
                expect(s.resolvePlayerContact(true)).toBe(StompResult.BLOCKED);
            }
        });

        it("kills the player on contact from any other direction", () => {
            for (const phase of [
                StalkerPhase.PATROL,
                StalkerPhase.ALERT,
                StalkerPhase.CHARGE,
                StalkerPhase.STUNNED,
            ]) {
                const s = makeStalker();
                s.enterPhase(phase);
                expect(s.resolvePlayerContact(false)).toBe(StompResult.KILLS_PLAYER);
            }
        });

        it("is harmless for a moment after blocking, so the rebound cannot kill", () => {
            // The blocked player is still overlapping the Stalker but now moving
            // upward, so without this grace the rebound resolves as a side hit.
            stalker.onBlocked();
            expect(stalker.resolvePlayerContact(false)).toBe(StompResult.BLOCKED);

            tick(stalker, BLOCK_GRACE_TIME - 1);
            expect(stalker.resolvePlayerContact(false)).toBe(StompResult.BLOCKED);
        });

        it("becomes dangerous again once that moment passes", () => {
            stalker.onBlocked();
            tick(stalker, BLOCK_GRACE_TIME);
            expect(stalker.resolvePlayerContact(false)).toBe(StompResult.KILLS_PLAYER);
        });

        it("is worth three ordinary stomps", () => {
            expect(stalker.stompValue()).toBe(STALKER_STOMP_VALUE);
        });
    });

    describe("dying", () => {
        it("stops dead and abandons its phase when killed", () => {
            stalker.enterPhase(StalkerPhase.CHARGE);
            stalker.setState(CreatureState.DYING);

            expect(stalker.getVelocity().x).toBe(0);
            expect(stalker.getVelocity().y).toBe(0);
            expect(stalker.phase).toBe(StalkerPhase.PATROL);
            expect(stalker.turnBlindTime).toBe(0);
            expect(stalker.blockGraceTime).toBe(0);
        });

        it("still finishes dying when killed mid-charge", () => {
            stalker.setPosition(500, 100);
            stalker.setTarget(targetAt(500 - 3 * TILE, 100));
            tick(stalker, 16);
            tick(stalker, ALERT_TIME + 1);
            expect(stalker.phase).toBe(StalkerPhase.CHARGE);

            stalker.setState(CreatureState.DYING);
            tick(stalker, stalker.DIE_TIME + 1);

            expect(stalker.getState()).toBe(CreatureState.DEAD);
        });
    });
});

describe("Stalker phase poses", () => {
    let stalker: Stalker;

    beforeEach(() => {
        stalker = makeStalker();
    });

    function currentAnim(s: Stalker): string {
        return (s as any).currAnimName;
    }

    it("shows a distinct pose while telegraphing, matching the way it faces", () => {
        stalker.facing = -1;
        stalker.enterPhase(StalkerPhase.ALERT);
        expect(currentAnim(stalker)).toBe("alertLeft");

        const other = makeStalker();
        other.facing = 1;
        other.enterPhase(StalkerPhase.ALERT);
        expect(currentAnim(other)).toBe("alertRight");
    });

    it("shows a distinct pose while stunned, matching the way it faces", () => {
        stalker.facing = -1;
        stalker.enterPhase(StalkerPhase.STUNNED);
        expect(currentAnim(stalker)).toBe("stunnedLeft");

        const other = makeStalker();
        other.facing = 1;
        other.enterPhase(StalkerPhase.STUNNED);
        expect(currentAnim(other)).toBe("stunnedRight");
    });

    it("keeps the pose while standing still, rather than being reset each frame", () => {
        // Creature.update() picks an animation from the velocity sign; with
        // vx == 0 it must leave the Stalker's own choice alone
        stalker.enterPhase(StalkerPhase.ALERT);
        for (let i = 0; i < 10; i++) tick(stalker, 16);
        expect(currentAnim(stalker)).toBe("alertLeft");
    });

    it("returns to the walk animation once it moves again", () => {
        stalker.enterPhase(StalkerPhase.STUNNED);
        expect(currentAnim(stalker)).toBe("stunnedLeft");

        stalker.enterPhase(StalkerPhase.CHARGE);
        expect(currentAnim(stalker)).toBe("left");

        stalker.facing = 1;
        stalker.enterPhase(StalkerPhase.PATROL);
        expect(currentAnim(stalker)).toBe("right");
    });

    it("plays the death animation when killed while stunned", () => {
        // the phase poses break Creature.setState's "left"/"right" check, and
        // stunned is the only phase in which it can be killed at all
        stalker.facing = -1;
        stalker.enterPhase(StalkerPhase.STUNNED);
        stalker.setState(CreatureState.DYING);
        expect(currentAnim(stalker)).toBe("deadLeft");

        const other = makeStalker();
        other.facing = 1;
        other.enterPhase(StalkerPhase.STUNNED);
        other.setState(CreatureState.DYING);
        expect(currentAnim(other)).toBe("deadRight");
    });
});

// GameMap.initialize() discovers the player part-way through the loop that
// builds the sprites, and in every map the player sits below most of the
// enemies. Assigning targets inline would therefore leave the enemies parsed
// before it pointing at nothing, so it runs as a second pass afterwards.
describe("assignTargets", () => {
    it("points every Stalker at the player", () => {
        const player = new Grub(); // stands in for the player sprite
        const first = new Stalker();
        const second = new Stalker();

        assignTargets([first, second], player);

        expect(first.getTarget()).toBe(player);
        expect(second.getTarget()).toBe(player);
    });

    it("leaves sprites that have no target alone", () => {
        const player = new Grub();
        const grub = new Grub();
        const fly = new Fly();
        const star = new Star();

        expect(() => assignTargets([grub, fly, star], player)).not.toThrow();
        expect(grub).not.toHaveProperty("target");
        expect(fly).not.toHaveProperty("target");
    });

    it("reaches a Stalker that comes before the player in the map", () => {
        // the case that breaks if targets are assigned during parsing
        const player = new Grub();
        const stalker = new Stalker();

        assignTargets([stalker, new Grub()], player);

        expect(stalker.getTarget()).toBe(player);
    });
});

// Nothing else fails loudly if the Stalker is dropped from the resource
// pipeline: buildSprite() would throw only once a level containing one is
// actually loaded in a browser, which no other test does.
describe("Stalker is wired into the asset pipeline", () => {
    const root = resolve(__dirname, "..");
    const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
    const resources = read("assets/resources/resources.json");
    const assets = read("assets/assets.json");

    it("is reachable from a map character", () => {
        expect(resources.maps.mappings["3"]).toBe("stalker");
    });

    it("is built by the type ResourceManager switches on", () => {
        expect(resources.sprites.stalker.type).toBe("Stalker");
    });

    it("declares every animation the Creature state machine switches to", () => {
        // a missing key leaves currAnimation undefined and the next update() throws
        expect(Object.keys(resources.sprites.stalker).sort()).toEqual(
            [
                "type",
                "left",
                "right",
                "alertLeft",
                "alertRight",
                "stunnedLeft",
                "stunnedRight",
                "deadLeft",
                "deadRight",
            ].sort()
        );
    });

    it("lists the walk animation first, since that becomes the active one", () => {
        expect(Object.keys(resources.sprites.stalker)[1]).toBe("left");
    });

    it("gives the stunned pose more than one frame so it actually animates", () => {
        // Sprite.update() only advances an animation with frames.length > 1
        expect(resources.sprites.stalker.stunnedLeft.length).toBeGreaterThan(1);
    });

    it("has the blocked-stomp sound registered", () => {
        expect(assets.sound.clang).toBeDefined();
    });

    it("actually appears in every level", () => {
        for (const level of resources.maps.levels) {
            const text = readFileSync(resolve(root, assets.text[level]), "utf8");
            const rows = text
                .split(/\r?\n/)
                .filter((l) => !l.startsWith("#") && !l.startsWith("@"));
            expect(rows.join("").includes("3"), level).toBe(true);
        }
    });
});
