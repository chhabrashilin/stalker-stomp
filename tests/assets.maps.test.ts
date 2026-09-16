import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { extname, resolve } from "path";
import { GRAVITY } from "../src/GameManager";
import { Player } from "../src/sprites/Player";

// Validates the asset manifests and every level file the game loads, including a
// tile-based reachability check that each level can actually be completed.

const ROOT = resolve(__dirname, "..");
const readText = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const assets = JSON.parse(readText("assets/assets.json"));
const resources = JSON.parse(readText("assets/resources/resources.json"));
const TILE_SIZE: number = resources.maps.TILE_SIZE;
const VIEWPORT = { width: 800, height: 600 };

// Highest jump in pixels is v^2 / 2g; express it (and a safe horizontal reach) in tiles.
const JUMP_RISE_TILES = Math.floor(new Player().JUMP_SPEED ** 2 / (2 * GRAVITY) / TILE_SIZE);
const JUMP_REACH_TILES = 4;

const COLLECTIBLES = ["o", "!", "^", "*"];

interface ParsedMap {
    name: string;
    tags: string[][];
    rows: string[];
    width: number;
    height: number;
}

// Same rules as GameMap.initialize: '#' lines are comments, '@' lines are tags,
// everything else is a row of tiles and sprites.
function parseMap(name: string): ParsedMap {
    const lines = readText(assets.text[name]).split(/\r?\n/);
    const tags = lines.filter((l) => l.startsWith("@")).map((l) => l.split(" "));
    const rows = lines.filter((l) => !l.startsWith("#") && !l.startsWith("@"));
    return {
        name,
        tags,
        rows,
        width: Math.max(...rows.map((r) => r.length)),
        height: rows.length,
    };
}

function cellAt(map: ParsedMap, x: number, y: number): string {
    return map.rows[y]?.charAt(x) || " ";
}

function isSolid(map: ParsedMap, x: number, y: number): boolean {
    if (x < 0 || x >= map.width) return true; // GameMap treats the map's sides as walls
    if (y < 0 || y >= map.height) return false;
    return /[A-Z]/.test(cellAt(map, x, y));
}

function find(map: ParsedMap, ch: string): { x: number; y: number }[] {
    const found = [];
    map.rows.forEach((row, y) => {
        [...row].forEach((c, x) => {
            if (c === ch) found.push({ x, y });
        });
    });
    return found;
}

// Drops from (x, y) until standing on something; null if it falls out of the map.
function fall(map: ParsedMap, x: number, y: number): { x: number; y: number } | null {
    while (!isSolid(map, x, y + 1)) {
        y++;
        if (y >= map.height) return null;
    }
    return { x, y };
}

// Every tile the player can stand in, starting from the spawn point.
function reachableStandingCells(map: ParsedMap): Set<string> {
    const [spawn] = find(map, "0");
    const start = fall(map, spawn.x, spawn.y);
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length) {
        const cell = queue.shift();
        if (!cell) continue;
        const key = `${cell.x},${cell.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const dir of [-1, 1]) {
            for (let rise = 0; rise <= JUMP_RISE_TILES; rise++) {
                if (rise > 0 && isSolid(map, cell.x, cell.y - rise)) break; // bumped head
                const apex = cell.y - rise;
                for (let dx = 1; dx <= JUMP_REACH_TILES; dx++) {
                    const nx = cell.x + dir * dx;
                    if (isSolid(map, nx, apex)) break;
                    queue.push(fall(map, nx, apex));
                }
            }
        }
    }
    return seen;
}

function canCollect(stands: Set<string>, item: { x: number; y: number }): boolean {
    return [...stands].some((key) => {
        const [x, y] = key.split(",").map(Number);
        return Math.abs(x - item.x) <= 1 && item.y <= y && item.y >= y - JUMP_RISE_TILES;
    });
}

function pngSize(path: string): { width: number; height: number } {
    const buf = readFileSync(resolve(ROOT, path));
    expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const levels: string[] = resources.maps.levels;

describe("asset manifests", () => {
    it("every file listed in assets.json exists", () => {
        for (const group of Object.values(assets) as { [key: string]: string }[]) {
            for (const path of Object.values(group)) {
                expect(existsSync(resolve(ROOT, path)), path).toBe(true);
            }
        }
    });

    it("registers at least three levels, each backed by a map file", () => {
        expect(levels.length).toBeGreaterThanOrEqual(3);
        expect(new Set(levels).size).toBe(levels.length);
        for (const level of levels) {
            expect(assets.text[level], level).toBeDefined();
        }
    });

    it("every sprite animation frame refers to a loaded image or sprite sheet", () => {
        for (const [name, sprite] of Object.entries(resources.sprites) as [string, any][]) {
            for (const [anim, frames] of Object.entries(sprite)) {
                if (anim === "type") continue;
                for (const frame of frames as any[]) {
                    const loaded = frame.sheet
                        ? assets.spritesheet[frame.sheet]
                        : assets.image[frame.img];
                    expect(loaded, `${name}.${anim}`).toBeDefined();
                }
            }
        }
    });

    it("all frames of each sprite share one size so animations don't jitter", () => {
        for (const [name, sprite] of Object.entries(resources.sprites) as [string, any][]) {
            const sizes = new Set<string>();
            for (const [anim, frames] of Object.entries(sprite)) {
                if (anim === "type") continue;
                for (const frame of frames as any[]) {
                    if (frame.img) {
                        const { width, height } = pngSize(assets.image[frame.img]);
                        sizes.add(`${width}x${height}`);
                    }
                }
            }
            expect(sizes.size, name).toBeLessThanOrEqual(1);
        }
    });

    it("sprite sheets divide evenly into their frames", () => {
        for (const sprite of Object.values(resources.sprites) as any[]) {
            for (const frames of Object.values(sprite)) {
                if (!Array.isArray(frames)) continue;
                for (const frame of frames.filter((f) => f.sheet)) {
                    const { width, height } = pngSize(assets.spritesheet[frame.sheet]);
                    expect(width % frame.cols).toBe(0);
                    expect(height % frame.rows).toBe(0);
                }
            }
        }
    });

    it("tiles are exactly one tile square", () => {
        for (const ch of "ABCDEFGHI") {
            const { width, height } = pngSize(assets.image[resources.images[ch]]);
            expect([width, height], ch).toEqual([TILE_SIZE, TILE_SIZE]);
        }
    });

    it("parallax layers fill the viewport, nearer layers wider than farther ones", () => {
        const far = pngSize(assets.image.bg1);
        const near = pngSize(assets.image.bg2);
        expect(far.width).toBeGreaterThanOrEqual(VIEWPORT.width);
        expect(far.height).toBe(VIEWPORT.height);
        expect(near.height).toBe(VIEWPORT.height);
        expect(near.width).toBeGreaterThan(far.width);
    });

    it("sounds are valid WAV files", () => {
        for (const path of Object.values(assets.sound) as string[]) {
            expect(extname(path)).toBe(".wav");
            const buf = readFileSync(resolve(ROOT, path));
            expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
            expect(buf.subarray(8, 12).toString("ascii")).toBe("WAVE");
            expect(buf.readUInt32LE(40), `${path} has audio data`).toBeGreaterThan(0);
        }
    });
});

describe.each(levels)("level %s", (level) => {
    const map = parseMap(level);

    it("has no trailing blank line (it would load as an extra empty row)", () => {
        expect(readText(assets.text[level]).endsWith("\n")).toBe(false);
        expect(map.rows[map.rows.length - 1].trim()).not.toBe("");
    });

    it("uses only tiles and sprites the game knows about", () => {
        const known = new Set([" ", ...Object.keys(resources.maps.mappings)]);
        map.rows.forEach((row, y) => {
            [...row].forEach((ch, x) => {
                const ok = /[A-Z]/.test(ch) ? ch in resources.images : known.has(ch);
                expect(ok, `'${ch}' at ${x},${y}`).toBe(true);
            });
        });
    });

    it("references parallax layers and music that are loaded", () => {
        for (const [tag, value] of map.tags) {
            if (tag === "@parallax-layer") expect(assets.image[value], value).toBeDefined();
            else if (tag === "@music") expect(assets.sound[value], value).toBeDefined();
            else throw new Error(`unknown tag ${tag}`);
        }
        expect(map.tags.filter(([t]) => t === "@parallax-layer")).toHaveLength(2);
    });

    it("has exactly one player and at least one goal", () => {
        expect(find(map, "0")).toHaveLength(1);
        expect(find(map, "*").length).toBeGreaterThanOrEqual(1);
    });

    it("fits the screen height and is wide enough to scroll", () => {
        expect(map.height * TILE_SIZE).toBeLessThanOrEqual(VIEWPORT.height + TILE_SIZE);
        expect(map.width * TILE_SIZE).toBeGreaterThan(VIEWPORT.width * 4);
    });

    it("has a solid floor all the way across, since falling off the map never ends", () => {
        for (let x = 0; x < map.width; x++) {
            expect(isSolid(map, x, map.height - 1), `column ${x}`).toBe(true);
        }
    });

    it("can be completed: the goal is reachable from the spawn point", () => {
        const stands = reachableStandingCells(map);
        for (const goal of find(map, "*")) {
            expect(canCollect(stands, goal), `goal at ${goal.x},${goal.y}`).toBe(true);
        }
    });

    it("every star, music note, and gem can be collected", () => {
        const stands = reachableStandingCells(map);
        for (const ch of COLLECTIBLES) {
            for (const item of find(map, ch)) {
                expect(canCollect(stands, item), `'${ch}' at ${item.x},${item.y}`).toBe(true);
            }
        }
    });
});

describe("reachability model", () => {
    it("derives a three-tile jump from the player's physics", () => {
        expect(JUMP_RISE_TILES).toBe(3);
    });

    it("rejects a goal behind a wall taller than the jump", () => {
        const wall: ParsedMap = {
            name: "wall",
            tags: [],
            rows: ["     A   ", "     A   ", "     A   ", "     A   ", " 0   A  *", "BBBBBBBBB"],
            width: 9,
            height: 6,
        };
        const stands = reachableStandingCells(wall);
        expect(canCollect(stands, { x: 8, y: 4 })).toBe(false);
    });

    it("accepts a goal behind a wall the player can jump over", () => {
        const wall: ParsedMap = {
            name: "step",
            tags: [],
            rows: ["         ", "         ", "     A   ", "     A   ", " 0   A  *", "BBBBBBBBB"],
            width: 9,
            height: 6,
        };
        const stands = reachableStandingCells(wall);
        expect(canCollect(stands, { x: 8, y: 4 })).toBe(true);
    });
});
