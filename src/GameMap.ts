import { Player } from "./sprites/Player.js";
import { ResourceManager } from "./ResourceManager.js";
import { Sprite } from "./sprites/Sprite.js";
import { GRAVITY } from "./GameManager.js";
import { Creature, CreatureState, StompResult } from "./sprites/Creature.js";
import { Stalker, BLOCK_BOUNCE } from "./sprites/Stalker.js";
import { Heart, Music, PowerUp, Star } from "./sprites/PowerUp.js";
import { Settings } from "./Settings.js";
import { POINTS, ScoreKeeper } from "./ScoreKeeper.js";

export const POPUP_LIFETIME = 900; //ms a "+points" label stays on screen
export const POPUP_RISE_SPEED = 0.05; //pixels per ms the label floats upward

export interface ScorePopup {
    x: number;
    y: number;
    text: string;
    age: number;
}

export function computeParallaxX(
    offsetX: number,
    myW: number,
    mapWidth: number,
    bgWidth: number
): number {
    // A map exactly one screen wide never scrolls, so its background stays put
    // (and the ratio below would otherwise be 0 / 0 = NaN).
    if (mapWidth === myW) {
        return 0;
    }
    // "+ 0" normalizes -0 (from a layer narrower than the viewport) to 0
    return Math.trunc((offsetX * (myW - bgWidth)) / (myW - mapWidth)) + 0;
}

/**
 * Points every Stalker at the player.
 *
 * This runs as a second pass once the whole map is parsed, rather than inline
 * while the sprites are created: initialize() discovers the player part-way
 * through the same loop, and in every map the player sits below most of the
 * enemies, so assigning a target inline would leave the enemies above it
 * pointing at nothing.
 */
export function assignTargets(sprites: Sprite[], player: Sprite) {
    sprites.forEach((s) => {
        if (s instanceof Stalker) {
            s.setTarget(player);
        }
    });
}

export class GameMap {
    tiles: p5.Image[][];
    tile_size: number;
    sprites: Sprite[];
    player: Player;
    background: p5.Image[];
    width: number; //height and width in tiles
    height: number;
    level: number;
    resources: ResourceManager;
    settings: Settings;
    prize: p5.SoundFile;
    music: p5.SoundFile;
    boop: p5.SoundFile;
    clang: p5.SoundFile;
    score: ScoreKeeper;
    popups: ScorePopup[];

    constructor(level: number, resources: ResourceManager, settings: Settings) {
        this.settings = settings;
        this.level = level;
        this.resources = resources;
        //created once per playthrough so the score survives deaths and level changes
        this.score = new ScoreKeeper();
        this.initialize();
    }

    initialize() {
        //no-op right after a level is cleared; after a death it rolls back that attempt's points
        this.score.restartLevel();
        this.popups = [];
        this.prize = this.resources.getLoad("prize");
        this.music = this.resources.getLoad("music");
        this.boop = this.resources.getLoad("boop2");
        this.clang = this.resources.getLoad("clang");
        this.sprites = [];
        this.background = []; //this.resources.get("background");
        this.tile_size = this.resources.get("TILE_SIZE");
        const mappings = this.resources.get("mappings");
        let map = this.resources.getLoad(this.resources.get("levels")[this.level]);
        if (!map) {
            this.level = 0;
            map = this.resources.getLoad(this.resources.get("levels")[this.level]);
        }
        const lines = [];
        let width = 0;
        let height = 0;
        map.forEach((line) => {
            if (!line.startsWith("#")) {
                //ignore comment lines
                if (line.startsWith("@")) {
                    const parts = line.split(" ");
                    switch (parts[0]) {
                        case "@parallax-layer": {
                            this.background.push(this.resources.getLoad(parts[1]));
                            break;
                        }
                        case "@music": {
                            this.music = this.resources.getLoad(parts[1]);
                            break;
                        }
                        default: {
                            console.warn("don't know how to handle this tag:" + parts[0]);
                            break;
                        }
                    }
                } else {
                    lines.push(line);
                    width = Math.max(width, line.length);
                }
            }
        });
        height = lines.length;
        this.width = width;
        this.height = height;
        this.tiles = [...Array(width)].map(() => Array(height));
        for (let y = 0; y < height; y++) {
            const line = lines[y];
            for (let x = 0; x < line.length; x++) {
                const ch = line.charAt(x);
                if (ch === " ") continue;
                //tiles are A-Z, sprites are a-z, 0-9, and special characters
                if (ch.match(/[A-Z]/)) {
                    //no need to look at mappings for tiles.
                    this.tiles[x][y] = this.resources.get(ch);
                } else {
                    const s = this.resources.get(mappings[ch]).clone();
                    s.setPosition(
                        this.tilesToPixels(x) + this.tile_size - s.getImage().width / 2,
                        this.tilesToPixels(y) + this.tile_size - s.getImage().height
                    );
                    if (ch == "0") {
                        //I don't like hard-coding in the character for the player.
                        this.player = s;
                    } else {
                        this.sprites.push(s);
                    }
                }
            }
        }
        assignTargets(this.sprites, this.player);
    }

    tilesToPixels(x: number): number {
        return Math.floor(x * this.tile_size);
    }

    pixelsToTiles(x: number): number {
        return Math.floor(x / this.tile_size);
    }

    draw(lives: number) {
        const myW = 800;
        const myH = 600;
        const mapWidth = this.tilesToPixels(this.width);
        const position = this.player.getPosition();
        let offsetX = myW / 2 - Math.round(position.x) - this.tile_size;
        offsetX = Math.min(offsetX, 0);
        offsetX = Math.trunc(Math.max(offsetX, myW - mapWidth));

        const offsetY = Math.trunc(myH - this.tilesToPixels(this.height));
        this.background.forEach((bg) => {
            const x = computeParallaxX(offsetX, myW, mapWidth, bg.width);
            const y = Math.trunc(myH - bg.height);
            image(bg, 0, 0, myW, myH, 0 - x, 0 - y, 800, 600);
        });

        const firstTileX = Math.trunc(this.pixelsToTiles(-offsetX));
        const lastTileX = Math.trunc(firstTileX + this.pixelsToTiles(myW) + 1);
        for (let y = 0; y < this.height; y++) {
            for (let x = firstTileX; x <= lastTileX; x++) {
                if (this.tiles[x] && this.tiles[x][y]) {
                    image(
                        this.tiles[x][y],
                        this.tilesToPixels(x) + offsetX,
                        this.tilesToPixels(y) + offsetY
                    );
                }
            }
        }

        image(
            this.player.getImage(),
            Math.trunc(Math.trunc(position.x) + offsetX),
            Math.trunc(Math.trunc(position.y) + offsetY)
        );

        this.sprites.forEach((sprite) => {
            const p = sprite.getPosition();
            image(
                sprite.getImage(),
                Math.trunc(Math.trunc(p.x) + offsetX),
                Math.trunc(Math.trunc(p.y) + offsetY)
            );
            if (sprite instanceof Creature && p.x + offsetX > 0 && p.x + offsetX < myW) {
                sprite.wakeUp();
            }
        });

        push();
        textAlign(CENTER, BOTTOM);
        textSize(18);
        strokeWeight(3);
        this.popups.forEach((popup) => {
            const alpha = 255 * (1 - popup.age / POPUP_LIFETIME);
            fill(255, 225, 110, alpha);
            stroke(0, alpha);
            text(popup.text, Math.trunc(popup.x + offsetX), Math.trunc(popup.y + offsetY));
        });
        pop();

        push();
        fill(0);
        stroke(255);
        strokeWeight(2);
        textSize(20);
        textAlign(LEFT, TOP);
        text(`Lives: ${lives}`, 10, 10);
        textAlign(RIGHT, TOP);
        text(`Score: ${this.score.score}`, myW - 10, 10);
        text(`Best: ${this.score.highScore}`, myW - 10, 36);
        pop();
    }

    isCollision(s1: Sprite, s2: Sprite): boolean {
        if (s1 == s2) return false;
        if (s1 instanceof Creature && (s1 as Creature).getState() != CreatureState.NORMAL)
            return false;
        if (s2 instanceof Creature && (s2 as Creature).getState() != CreatureState.NORMAL)
            return false;
        const pos1 = s1.getPosition().copy();
        const pos2 = s2.getPosition().copy();
        pos1.x = Math.round(pos1.x);
        pos1.y = Math.round(pos1.y);
        pos2.x = Math.round(pos2.x);
        pos2.y = Math.round(pos2.y);
        const i1 = s1.getImage();
        const i2 = s2.getImage();
        const val =
            pos1.x < pos2.x + i2.width &&
            pos2.x < pos1.x + i1.width &&
            pos1.y < pos2.y + i2.height &&
            pos2.y < pos1.y + i1.height;
        return val;
    }

    getSpriteCollision(s: Sprite): Sprite {
        for (const other of this.sprites) {
            if (this.isCollision(s, other)) {
                return other;
            }
        }
        return null;
    }

    checkPlayerCollision(p: Player, canKill: boolean) {
        if (p.getState() != CreatureState.NORMAL) return;
        const s = this.getSpriteCollision(p);
        if (!s) return;
        if (s instanceof Creature) {
            //the creature decides, so an armoured enemy can refuse a stomp
            switch (s.resolvePlayerContact(canKill)) {
                case StompResult.KILLS_CREATURE: {
                    this.stompCreature(p, s);
                    break;
                }
                case StompResult.BLOCKED: {
                    this.blockedByCreature(p, s);
                    break;
                }
                case StompResult.KILLS_PLAYER: {
                    p.setState(CreatureState.DYING);
                    break;
                }
            }
        } else if (s instanceof PowerUp) {
            this.acquirePowerUp(s);
        }
    }

    stompCreature(p: Player, s: Creature) {
        s.setState(CreatureState.DYING);
        this.showPoints(s, this.score.stomp(POINTS.STOMP * s.stompValue()));
        if (this.settings.playEvents) {
            this.boop.play();
        }
        p.setPosition(p.getPosition().x, s.getPosition().y - p.getImage().height);
        p.jump(true);
    }

    /**
     * The player landed on something that shrugged it off. They are put on top
     * of the creature as a real stomp would, which also separates them: left
     * overlapping, the rebound upward would resolve as a side hit and kill them.
     * The bounce is much shorter than a stomp's so it reads as being blocked,
     * and it scores nothing -- but it does not break the stomp chain either.
     */
    blockedByCreature(p: Player, s: Creature) {
        s.onBlocked();
        p.setPosition(p.getPosition().x, s.getPosition().y - p.getImage().height);
        p.setVelocity(0, -p.JUMP_SPEED * BLOCK_BOUNCE);
        if (this.settings.playEvents) {
            this.clang.play();
        }
    }

    removeSprite(s: Sprite) {
        const i = this.sprites.indexOf(s);
        if (i > -1) this.sprites.splice(i, 1);
    }

    acquirePowerUp(p: PowerUp) {
        this.removeSprite(p);
        if (p instanceof Heart) {
            const bonus = this.score.clearLevel();
            this.level += 1;
            this.initialize();
            this.showPoints(this.player, bonus, "Level clear! ");
            return;
        }
        if (p instanceof Star) {
            this.showPoints(p, this.score.collectStar());
        } else if (p instanceof Music) {
            this.showPoints(p, this.score.collectMusic());
        } else {
            //any other power-up is a gem
            this.showPoints(p, this.score.collectGem());
        }
        if (this.settings.playEvents) {
            this.prize.play();
        }
    }

    /**
     * Floats a "+points" label up from the top-center of the given sprite.
     */
    showPoints(s: Sprite, points: number, label = "") {
        const pos = s.getPosition();
        const img = s.getImage();
        this.popups.push({
            x: pos.x + (img ? img.width / 2 : 0),
            y: pos.y,
            text: `${label}+${points}`,
            age: 0,
        });
    }

    updatePopups(elapsedTime: number) {
        this.popups.forEach((popup) => {
            popup.age += elapsedTime;
            popup.y -= POPUP_RISE_SPEED * elapsedTime;
        });
        this.popups = this.popups.filter((popup) => popup.age < POPUP_LIFETIME);
    }

    getTileCollision(s: Sprite, newPos: p5.Vector) {
        const oldPos = s.getPosition();
        const fromX = Math.min(oldPos.x, newPos.x);
        const fromY = Math.min(oldPos.y, newPos.y);
        const toX = Math.max(oldPos.x, newPos.x);
        const toY = Math.max(oldPos.y, newPos.y);
        const fromTileX = this.pixelsToTiles(fromX);
        const fromTileY = this.pixelsToTiles(fromY);
        const toTileX = this.pixelsToTiles(toX + s.getImage().width - 1);
        const toTileY = this.pixelsToTiles(toY + s.getImage().height - 1);
        for (let x = fromTileX; x <= toTileX; x++) {
            for (let y = fromTileY; y <= toTileY; y++) {
                if (x < 0 || x >= this.tiles.length || this.tiles[x][y]) {
                    return createVector(x, y);
                }
            }
        }
        return null;
    }

    updateSprite(s: Sprite) {
        //update velocity due to gravity
        const oldVel = s.getVelocity();
        const newPos = s.getPosition().copy();

        if (!s.isFlying()) {
            oldVel.y = oldVel.y + GRAVITY * deltaTime;
            s.setVelocity(oldVel.x, oldVel.y);
        }

        //update the x part of position first
        newPos.x = newPos.x + oldVel.x * deltaTime;
        //see if there was a collision with a tile at the new location
        let point = this.getTileCollision(s, newPos);
        if (point) {
            if (oldVel.x > 0) {
                //moving to the right
                newPos.x = this.tilesToPixels(point.x) - s.getImage().width;
            } else if (oldVel.x < 0) {
                //moving to the left
                newPos.x = this.tilesToPixels(point.x + 1);
            }
            s.collideHorizontal();
        }
        s.setPosition(newPos.x, newPos.y);
        if (s instanceof Player) {
            this.checkPlayerCollision(s as Player, false);
        }

        //now update the y part of the position
        const oldY = newPos.y;
        newPos.y = newPos.y + oldVel.y * deltaTime;
        point = this.getTileCollision(s, newPos);
        if (point) {
            if (oldVel.y > 0) {
                newPos.y = this.tilesToPixels(point.y) - s.getImage().height;
            } else if (oldVel.y < 0) {
                newPos.y = this.tilesToPixels(point.y + 1);
            }
            s.collideVertical();
        }
        s.setPosition(newPos.x, newPos.y);
        if (s instanceof Player) {
            this.checkPlayerCollision(s as Player, oldY < newPos.y);
        }
    }

    update() {
        if (this.player.getState() == CreatureState.DEAD) {
            return; //wait for GameManager to decide whether to restart or end the game
        }
        this.updateSprite(this.player); //moves sprite within the game
        this.player.update(deltaTime); //updates the animation of the sprite
        if (this.player.onGround) {
            this.score.land(); //touching the ground ends a stomp chain
        }
        this.updatePopups(deltaTime);

        this.sprites.forEach((sprite, index, obj) => {
            if (sprite instanceof Creature) {
                if (sprite.getState() == CreatureState.DEAD) {
                    //remove the sprite
                    obj.splice(index, 1);
                } else {
                    this.updateSprite(sprite);
                    sprite.update(deltaTime);
                }
            } else if (sprite instanceof PowerUp) {
                sprite.update(deltaTime);
            }
        });
    }
}
