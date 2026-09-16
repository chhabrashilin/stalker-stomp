import { Sprite } from "./Sprite.js";

/**
 * A Creature is a Sprite that is affected by gravity and can die.
 */

export enum CreatureState {
    DEAD,
    DYING,
    NORMAL,
}

/**
 * What happens when the player touches a creature.  GameMap asks the creature
 * itself rather than deciding, so an enemy can refuse to be stomped.
 */
export enum StompResult {
    KILLS_CREATURE,
    BLOCKED,
    KILLS_PLAYER,
}

export class Creature extends Sprite {
    DIE_TIME = 1000;

    state: CreatureState;
    stateTime: number;

    constructor() {
        super();
        this.state = CreatureState.NORMAL;
        this.stateTime = 0;
    }

    clone() {
        const s = super.clone();
        s.state = this.state;
        s.stateTime = this.stateTime;
        return s;
    }

    getState() {
        return this.state;
    }

    setState(st: CreatureState) {
        if (st != this.state) {
            this.stateTime = 0;
            this.state = st;
            if (this.state == CreatureState.DYING) {
                this.setVelocity(0, 0);
                if (this.currAnimName == "left") {
                    this.setAnimation("deadLeft");
                }
                if (this.currAnimName == "right") {
                    this.setAnimation("deadRight");
                }
            }
        }
    }

    wakeUp() {
        if (this.getState() == CreatureState.NORMAL && this.velocity.x == 0) {
            this.setVelocity(-this.getMaxSpeed(), 0);
        }
    }

    getMaxSpeed() {
        return 0;
    }

    /**
     * Decides the outcome of the player touching this creature.  The default is
     * the long-standing rule: landing on a creature kills it, anything else
     * kills the player.
     */
    resolvePlayerContact(fromAbove: boolean): StompResult {
        return fromAbove ? StompResult.KILLS_CREATURE : StompResult.KILLS_PLAYER;
    }

    /**
     * Called when this creature shrugged off a stomp.  A no-op for creatures
     * that can always be stomped, so GameMap never needs to know the subclass.
     */
    onBlocked() {}

    /**
     * How many times a normal stomp this creature is worth.  A weight rather
     * than a point total, so the sprites stay independent of the scoring rules.
     */
    stompValue(): number {
        return 1;
    }

    update(deltaTime: number) {
        let newAnim = "";
        if (this.velocity.x < 0) {
            newAnim = "left";
        } else if (this.velocity.x > 0) {
            newAnim = "right";
        }
        if (newAnim != "" && newAnim != this.currAnimName) {
            this.setAnimation(newAnim);
        } else {
            super.update(deltaTime);
        }
        this.stateTime += deltaTime;
        if (this.state == CreatureState.DYING && this.stateTime > this.DIE_TIME) {
            this.setState(CreatureState.DEAD);
        }
    }
}

export class Grub extends Creature {
    getMaxSpeed() {
        return 0.05;
    }
}

export class Fly extends Creature {
    isFlying() {
        return this.state == CreatureState.NORMAL;
    }

    getMaxSpeed() {
        return 0.2;
    }
}
