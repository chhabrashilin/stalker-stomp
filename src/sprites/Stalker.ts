import { Creature, CreatureState, StompResult } from "./Creature.js";
import { Sprite } from "./Sprite.js";

/**
 * A Stalker patrols like a Grub until it notices the player in front of it, then
 * stops to telegraph the attack and charges. A charge ends against a wall or on
 * a timer, and either way it is left stunned and briefly vulnerable -- that is
 * the only moment it can be stomped. Landing on it at any other time bounces the
 * player off its armour without hurting either of them.
 *
 * Both endings lead to the same stunned phase on purpose. If a charge that timed
 * out went straight back to patrolling, the Stalker would be unkillable wherever
 * the level happens not to provide a wall.
 *
 * Distances are given here in pixels; TILE_SIZE is 64.
 */

export enum StalkerPhase {
    PATROL,
    ALERT,
    CHARGE,
    STUNNED,
}

export const PATROL_SPEED = 0.05; //same as a Grub, so it reads as one until it notices you
export const CHARGE_SPEED = 0.32; //5 tiles per second
export const DETECT_X = 256; //4 tiles ahead
export const DETECT_Y = 64; //within one tile vertically
export const ALERT_TIME = 300; //the tell, before it commits
export const CHARGE_TIME = 1000; //covers exactly 5 tiles unobstructed
export const STUN_TIME = 800; //the window in which it can be stomped
export const TURN_BLIND_TIME = 400; //cannot notice the player just after turning
export const BLOCK_GRACE_TIME = 250; //contact is harmless just after a blocked stomp
export const BLOCK_BOUNCE = 0.45; //fraction of a jump, so about a fifth the height
export const STALKER_STOMP_VALUE = 3; //worth three ordinary stomps

export class Stalker extends Creature {
    phase: StalkerPhase;
    phaseTime: number;
    facing: number; //-1 for left, 1 for right; starts left to match wakeUp()
    turnBlindTime: number;
    blockGraceTime: number;
    onScreen: boolean; //set by wakeUp(), which GameMap.draw() only calls when visible
    target: Sprite;
    targetWarned: boolean;

    constructor() {
        super();
        this.phase = StalkerPhase.PATROL;
        this.phaseTime = 0;
        this.facing = -1;
        this.turnBlindTime = 0;
        this.blockGraceTime = 0;
        this.onScreen = false;
        this.target = null;
        this.targetWarned = false;
    }

    /**
     * Sprite.clone() only copies a fixed list of fields, so everything added
     * here has to be carried over explicitly or it silently reverts to the
     * constructor default.
     */
    clone() {
        const s = super.clone();
        s.phase = this.phase;
        s.phaseTime = this.phaseTime;
        s.facing = this.facing;
        s.turnBlindTime = this.turnBlindTime;
        s.blockGraceTime = this.blockGraceTime;
        s.target = this.target;
        return s;
    }

    setTarget(target: Sprite) {
        this.target = target;
    }

    getTarget(): Sprite {
        return this.target;
    }

    getMaxSpeed() {
        return PATROL_SPEED; //"normal" speed; charging uses CHARGE_SPEED directly
    }

    stompValue(): number {
        return STALKER_STOMP_VALUE;
    }

    /**
     * GameMap.draw() calls this every frame the sprite is on screen, which makes
     * it the engine's existing visibility signal -- so the Stalker can gate
     * hunting on being visible without knowing anything about the camera.
     *
     * The inherited version pushes a stationary creature into motion, which
     * would overwrite the deliberate standstill of the alert and stunned
     * phases, so only patrolling defers to it.
     */
    wakeUp() {
        this.onScreen = true;
        if (this.phase == StalkerPhase.PATROL) {
            super.wakeUp();
        }
    }

    /**
     * True when the player is close enough, level enough, and in front. Uses
     * positions only: a Stalker built in a unit test has no animation frames, so
     * getImage() would be null. Positions are top edges, which the one-tile
     * vertical band absorbs.
     */
    canDetect(): boolean {
        if (!this.onScreen || this.turnBlindTime > 0 || !this.target) {
            return false;
        }
        if (this.getState() != CreatureState.NORMAL) {
            return false;
        }
        const here = this.getPosition();
        const there = this.target.getPosition();
        const dx = there.x - here.x;
        const dy = there.y - here.y;
        if (Math.sign(dx) != this.facing) {
            return false; //behind it, so it can be approached from that side
        }
        return Math.abs(dx) <= DETECT_X && Math.abs(dy) <= DETECT_Y;
    }

    enterPhase(phase: StalkerPhase) {
        this.phase = phase;
        this.phaseTime = 0;
        switch (phase) {
            case StalkerPhase.PATROL: {
                //set explicitly so it resumes the way it is facing rather than
                //waiting for wakeUp(), which always starts a creature moving left
                this.setVelocity(this.facing * PATROL_SPEED, this.velocity.y);
                break;
            }
            case StalkerPhase.CHARGE: {
                this.setVelocity(this.facing * CHARGE_SPEED, this.velocity.y);
                break;
            }
            case StalkerPhase.ALERT: {
                //setVelocity with x == 0 leaves the animation alone, and so does
                //Creature.update() while it is standing still, so the pose holds
                this.setVelocity(0, this.velocity.y);
                this.setAnimation(this.facing < 0 ? "alertLeft" : "alertRight");
                break;
            }
            case StalkerPhase.STUNNED: {
                this.setVelocity(0, this.velocity.y);
                this.setAnimation(this.facing < 0 ? "stunnedLeft" : "stunnedRight");
                break;
            }
        }
    }

    /**
     * A charge ends the moment it hits something; anything else keeps the
     * inherited bounce, which is what makes it patrol back and forth.
     */
    collideHorizontal() {
        if (this.phase == StalkerPhase.CHARGE) {
            this.enterPhase(StalkerPhase.STUNNED);
            return;
        }
        super.collideHorizontal();
        this.facing = -this.facing;
        this.turnBlindTime = TURN_BLIND_TIME;
    }

    resolvePlayerContact(fromAbove: boolean): StompResult {
        if (this.blockGraceTime > 0) {
            //it just blocked a stomp, so the player is still overlapping it on
            //the way back up; without this that rebound reads as a side hit
            return StompResult.BLOCKED;
        }
        if (!fromAbove) {
            return StompResult.KILLS_PLAYER;
        }
        return this.phase == StalkerPhase.STUNNED
            ? StompResult.KILLS_CREATURE
            : StompResult.BLOCKED;
    }

    onBlocked() {
        this.blockGraceTime = BLOCK_GRACE_TIME;
    }

    setState(st: CreatureState) {
        const wasNormal = this.state == CreatureState.NORMAL;
        super.setState(st);
        if (wasNormal && st != CreatureState.NORMAL) {
            this.phase = StalkerPhase.PATROL;
            this.phaseTime = 0;
            this.turnBlindTime = 0;
            this.blockGraceTime = 0;
            if (st == CreatureState.DYING) {
                //Creature.setState picks the death animation by looking at the
                //current one, which only recognises "left" and "right". A Stalker
                //can only be killed while stunned, so by then the current
                //animation is the stunned pose and it would never switch. Choose
                //it from the direction it faces instead.
                this.setAnimation(this.facing < 0 ? "deadLeft" : "deadRight");
            }
        }
    }

    /**
     * A Stalker with no target is a wiring mistake, not a player-facing failure,
     * so say so once and carry on patrolling rather than either failing silently
     * or taking the whole level down.
     */
    warnMissingTarget() {
        if (this.targetWarned) {
            return;
        }
        this.targetWarned = true;
        console.error(
            "Stalker has no target and will only patrol. GameMap.initialize() must call " +
                "assignTargets(this.sprites, this.player) after parsing the map."
        );
    }

    update(deltaTime: number) {
        if (this.getState() == CreatureState.NORMAL) {
            if (!this.target) {
                this.warnMissingTarget();
            }
            this.turnBlindTime = Math.max(0, this.turnBlindTime - deltaTime);
            this.blockGraceTime = Math.max(0, this.blockGraceTime - deltaTime);
            this.phaseTime += deltaTime;
            this.advancePhase();
        }
        super.update(deltaTime);
        this.onScreen = false; //re-set by the next draw() if still visible
    }

    advancePhase() {
        switch (this.phase) {
            case StalkerPhase.PATROL: {
                if (this.canDetect()) {
                    this.enterPhase(StalkerPhase.ALERT);
                }
                break;
            }
            case StalkerPhase.ALERT: {
                if (this.phaseTime > ALERT_TIME) {
                    this.enterPhase(StalkerPhase.CHARGE);
                }
                break;
            }
            case StalkerPhase.CHARGE: {
                if (this.phaseTime > CHARGE_TIME) {
                    this.enterPhase(StalkerPhase.STUNNED);
                }
                break;
            }
            case StalkerPhase.STUNNED: {
                if (this.phaseTime > STUN_TIME) {
                    this.enterPhase(StalkerPhase.PATROL);
                }
                break;
            }
        }
    }
}
