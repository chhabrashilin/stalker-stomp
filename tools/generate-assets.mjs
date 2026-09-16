/**
 * Generates every image and sound in assets/ for the "Lantern Grove" theme:
 * a moonlit forest drawn as chunky pixel art with one shared palette, plus
 * chiptune music and effects synthesized from the same square/triangle voices.
 *
 * Everything is procedural and seeded, so running it again reproduces the same files.
 * No dependencies beyond Node itself.
 *
 *   node tools/generate-assets.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGES = path.join(ROOT, "assets", "images");
const SOUNDS = path.join(ROOT, "assets", "sounds");

// ─────────────────────────────── utilities ───────────────────────────────

function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hex(h, a = 255) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

function withAlpha(c, a) {
    return [c[0], c[1], c[2], a];
}

// ─────────────────────────────── PNG encoder ───────────────────────────────

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function encodePNG(canvas) {
    const { w, h, px } = canvas;
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header[8] = 8; // bit depth
    header[9] = 6; // RGBA
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 4 + 1)] = 0; // no filter
        Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

// ─────────────────────────────── canvas ───────────────────────────────

class Canvas {
    constructor(w, h) {
        this.w = w;
        this.h = h;
        this.px = new Uint8Array(w * h * 4);
    }

    alpha(x, y) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
        return this.px[(y * this.w + x) * 4 + 3];
    }

    // source-over blend of c onto the pixel
    set(x, y, c) {
        x = Math.floor(x);
        y = Math.floor(y);
        if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = (y * this.w + x) * 4;
        const a = c[3] / 255;
        const da = this.px[i + 3] / 255;
        const oa = a + da * (1 - a);
        if (oa === 0) return;
        for (let k = 0; k < 3; k++) {
            this.px[i + k] = Math.round((c[k] * a + this.px[i + k] * da * (1 - a)) / oa);
        }
        this.px[i + 3] = Math.round(oa * 255);
    }

    // destination-over: paints c behind whatever is already there
    under(x, y, c) {
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = (y * this.w + x) * 4;
        const top = [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]];
        this.px.fill(0, i, i + 4);
        this.set(x, y, c);
        this.set(x, y, top);
    }

    rect(x, y, w, h, c) {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    }

    hline(x0, x1, y, c) {
        for (let x = x0; x <= x1; x++) this.set(x, y, c);
    }

    vline(x, y0, y1, c) {
        for (let y = y0; y <= y1; y++) this.set(x, y, c);
    }

    ellipse(cx, cy, rx, ry, c) {
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
                const dx = (x + 0.5 - cx) / rx;
                const dy = (y + 0.5 - cy) / ry;
                if (dx * dx + dy * dy <= 1) this.set(x, y, c);
            }
        }
    }

    disc(cx, cy, r, c) {
        this.ellipse(cx, cy, r, r, c);
    }

    poly(points, c) {
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
            for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
                if (insidePolygon(x + 0.5, y + 0.5, points)) this.set(x, y, c);
            }
        }
    }

    // soft radial glow painted behind existing pixels
    glow(cx, cy, r, c) {
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
                const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
                if (d < 1) {
                    // quantized falloff keeps the pixel-art look
                    const step = Math.ceil((1 - d) * 3) / 3;
                    this.under(x, y, withAlpha(c, Math.round(c[3] * step)));
                }
            }
        }
    }

    // 1px outline around every solid pixel
    outline(c) {
        const solid = (x, y) => this.alpha(x, y) >= 200;
        const marks = [];
        for (let y = 0; y < this.h; y++) {
            for (let x = 0; x < this.w; x++) {
                if (this.alpha(x, y) === 0 && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
                    marks.push([x, y]);
                }
            }
        }
        marks.forEach(([x, y]) => this.set(x, y, c));
    }

    // recolors solid pixels whose neighbour in (dx, dy) is empty, e.g. rim lighting
    rim(dx, dy, c) {
        const marks = [];
        for (let y = 0; y < this.h; y++) {
            for (let x = 0; x < this.w; x++) {
                if (this.alpha(x, y) >= 200 && this.alpha(x + dx, y + dy) === 0) marks.push([x, y]);
            }
        }
        marks.forEach(([x, y]) => this.set(x, y, c));
    }

    scaled(f) {
        const out = new Canvas(this.w * f, this.h * f);
        for (let y = 0; y < out.h; y++) {
            for (let x = 0; x < out.w; x++) {
                const si = (Math.floor(y / f) * this.w + Math.floor(x / f)) * 4;
                const di = (y * out.w + x) * 4;
                out.px[di] = this.px[si];
                out.px[di + 1] = this.px[si + 1];
                out.px[di + 2] = this.px[si + 2];
                out.px[di + 3] = this.px[si + 3];
            }
        }
        return out;
    }

    blit(src, ox, oy) {
        for (let y = 0; y < src.h; y++) {
            for (let x = 0; x < src.w; x++) {
                const i = (y * src.w + x) * 4;
                const a = src.px[i + 3];
                if (a) this.set(ox + x, oy + y, [src.px[i], src.px[i + 1], src.px[i + 2], a]);
            }
        }
    }
}

function insidePolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

// ─────────────────────────────── palette ───────────────────────────────

const P = {
    ink: hex("#0b0a1a"),
    night0: hex("#0c0f2e"),
    night1: hex("#141a45"),
    night2: hex("#20266a"),
    dusk: hex("#382d6e"),
    horizon: hex("#5e3a78"),
    moon: hex("#f6ecc8"),
    moonShade: hex("#d8c796"),
    ridgeFar: hex("#272b62"),
    ridgeNear: hex("#1c1f52"),
    tree: hex("#0f1130"),
    treeRim: hex("#2b2f6e"),
    stone0: hex("#27233f"),
    stone1: hex("#3b355d"),
    stone2: hex("#544c80"),
    stone3: hex("#7a70a8"),
    moss0: hex("#23684f"),
    moss1: hex("#3a9a6c"),
    moss2: hex("#79d596"),
    wood0: hex("#3f2838"),
    wood1: hex("#65404f"),
    wood2: hex("#8e5c69"),
    lantern: hex("#ffd166"),
    lanternHot: hex("#fff4c2"),
    ember: hex("#ff9f43"),
    cloak0: hex("#1b5f6f"),
    cloak1: hex("#2a9aa3"),
    cloak2: hex("#6fd8cf"),
    skin: hex("#f1c9a0"),
    slime0: hex("#3b8a3a"),
    slime1: hex("#76d158"),
    slime2: hex("#cdf7a4"),
    bat0: hex("#33204c"),
    bat1: hex("#613a86"),
    bat2: hex("#9f79cc"),
    gem0: hex("#9a2c76"),
    gem1: hex("#ff5cb6"),
    gem2: hex("#ffc6ea"),
    note0: hex("#1b77a3"),
    note1: hex("#4ccfff"),
    note2: hex("#c8f3ff"),
    heart0: hex("#a82a57"),
    heart1: hex("#ff5a87"),
    heart2: hex("#ffc3d4"),
    stalk0: hex("#7c2f1c"),
    stalk1: hex("#c2542a"),
    stalk2: hex("#f0904e"),
    golem0: hex("#342f52"),
    golem1: hex("#5a538c"),
    golem2: hex("#8d84c2"),
    white: hex("#ffffff"),
};

// ─────────────────────────────── sprites ───────────────────────────────
// All characters face left; resources.json mirrors them for the right-facing animations.

function drawPlayer(frame) {
    const c = new Canvas(20, 16);
    const bob = [0, 1, 0][frame];
    // cloak
    c.poly([[8, 6 + bob], [14, 6 + bob], [17, 14], [6, 14]], P.cloak1);
    c.poly([[12, 6 + bob], [14, 6 + bob], [17, 14], [13, 14]], P.cloak0);
    c.vline(7, 11, 13, P.cloak2);
    // hood with a pointed tip trailing behind
    c.disc(11.5, 4.5 + bob, 3.6, P.cloak1);
    c.disc(13, 4 + bob, 2.2, P.cloak0);
    c.set(15, 2 + bob, P.cloak0);
    c.set(16, 1 + bob, P.cloak0);
    // face peeking out of the hood
    c.rect(8, 4 + bob, 2, 3, P.skin);
    c.set(8, 5 + bob, P.ink);
    // arm holding the lantern out front
    c.hline(5, 9, 9 + bob, P.cloak0);
    // legs
    const legs = [
        [9, 13],
        [7, 14],
        [10, 12],
    ][frame];
    c.rect(legs[0], 14, 2, 2, P.stone0);
    c.rect(legs[1], 14, 2, 2, P.stone0);
    // lantern
    const ly = bob;
    c.vline(4, 8 + ly, 8 + ly, P.stone3);
    c.rect(3, 9 + ly, 3, 1, P.wood0);
    c.rect(3, 10 + ly, 3, 3, P.lantern);
    c.set(4, 11 + ly, P.lanternHot);
    c.rect(3, 13 + ly, 3, 1, P.wood0);
    c.outline(P.ink);
    c.glow(4.5, 11.5 + ly, 5, withAlpha(P.lantern, 140));
    return c.scaled(4); // 80x64
}

function drawSlime(frame) {
    const c = new Canvas(16, 12);
    const rx = [6, 7][frame];
    const ry = [8.8, 7][frame];
    const top = 11 - ry;
    for (let y = 0; y <= 10; y++) {
        for (let x = 0; x < 16; x++) {
            const dx = (x + 0.5 - 8) / rx;
            const dy = (y + 0.5 - 11) / ry;
            if (dx * dx + dy * dy <= 1) c.set(x, y, x >= 10 ? P.slime0 : P.slime1);
        }
    }
    c.set(4, Math.round(top) + 2, P.slime2);
    c.set(5, Math.round(top) + 1, P.slime2);
    c.set(4, Math.round(top) + 3, P.slime2);
    const eyeY = Math.round(top + ry * 0.45);
    for (const ex of [5, 8]) {
        c.rect(ex, eyeY, 1, 2, P.ink);
        c.set(ex, eyeY, P.white);
    }
    c.hline(6, 7, eyeY + 3, P.slime0);
    c.outline(P.ink);
    return c.scaled(4); // 64x48
}

function drawBat(frame) {
    const c = new Canvas(16, 12);
    const tip = [1, 5, 10][frame];
    c.poly([[7, 5], [1, tip], [2, tip + 2], [4, tip + 1], [7, 8]], P.bat0);
    c.poly([[9, 5], [15, tip], [14, tip + 2], [12, tip + 1], [9, 8]], P.bat0);
    c.set(3, tip + 1, P.bat2);
    c.set(13, tip + 1, P.bat2);
    c.disc(8, 6.5, 2.8, P.bat1);
    c.set(6, 3, P.bat1);
    c.set(10, 3, P.bat1);
    c.set(6, 6, P.lantern);
    c.set(8, 6, P.lantern);
    c.set(7, 8, P.bat2);
    c.outline(P.ink);
    return c.scaled(4); // 64x48
}

// The stalker: a low prowler that patrols, freezes to telegraph, then charges.
// Every pose shares one 16x12 canvas so the frames cannot jitter, and the game
// only ever mirrors these left-facing frames for the right-facing animations.
function stalkerPose({
    crouch = 0,
    bob = 0,
    front = 4,
    back = 10,
    ear = 1,
    tail = 0,
    headDrop = 0,
    hackles = false,
    eye = P.lantern,
}) {
    const c = new Canvas(16, 12);
    const y = crouch;
    const hy = 6 + y + bob + headDrop; // head sits lower when it stalks or slumps

    // tail: swept up when it is about to spring, dropped when it is beaten
    c.poly([[12, 5 + y], [15, 4 + y - tail], [15, 6 + y - tail], [13, 7 + y]], P.stalk0);

    // legs reach from the belly to the ground, so a crouch shortens them
    c.rect(front, 8 + y, 2, 4 - y, P.stalk0);
    c.rect(back, 8 + y, 2, 4 - y, P.stalk0);

    // haunches, belly shadow, and the lit ridge along the back
    c.ellipse(9, 6 + y + bob, 5, 2.8, P.stalk1);
    c.ellipse(9, 7.4 + y + bob, 4.4, 1.4, P.stalk0);
    c.hline(7, 12, 4 + y + bob, P.stalk2);

    // raised hackles down the spine, the silhouette cue that it has seen you
    if (hackles) {
        for (const x of [7, 9, 11]) {
            c.poly([[x - 1, 4 + y + bob], [x, 1 + y + bob], [x + 1, 4 + y + bob]], P.stalk0);
        }
    }

    // head and snout, low and forward
    c.disc(4, hy, 2.4, P.stalk1);
    c.rect(1, hy, 3, 2, P.stalk0);

    // ear, pinned flat when it is stalking or stunned
    c.poly([[5, hy - 2], [6, hy - 4 + (1 - ear) * 2], [7, hy - 2]], P.stalk0);

    // the eye is the tell: it is what changes most between phases
    c.set(3, hy - 1, eye);
    c.glow(3.5, hy - 0.5, 3, withAlpha(eye, 120));
    c.outline(P.ink);
    return c;
}

function drawStalker(frame) {
    // walking: the legs swap and the body rocks a pixel
    return stalkerPose({
        bob: [0, 1][frame],
        front: [3, 5][frame],
        back: [11, 9][frame],
    }).scaled(4); // 64x48
}

function drawStalkerAlert() {
    // the tell: crouched low, hackles up, tail raised, eye burning.
    // One frame only, so it holds perfectly still for the 300ms it lasts.
    const c = stalkerPose({
        crouch: 1,
        front: 3,
        back: 11,
        ear: 0,
        tail: 3,
        headDrop: 1,
        hackles: true,
        eye: P.lanternHot,
    });
    c.glow(3.5, 8, 5, withAlpha(P.ember, 170));
    return c.scaled(4); // 64x48
}

function drawStalkerStunned(frame) {
    // slumped, tail down, head hanging: the only moment it can be stomped
    const c = stalkerPose({
        crouch: 2,
        front: 2,
        back: 11,
        ear: 0,
        tail: -2,
        headDrop: 1,
        eye: frame === 0 ? P.stalk0 : P.ember,
    });
    // sparks circling the head, alternating so the pose visibly pulses
    const sparks = [
        [[2, 1], [7, 0]],
        [[5, 0], [1, 2]],
    ][frame];
    sparks.forEach(([x, yy]) => {
        c.set(x, yy, P.lanternHot);
        c.glow(x + 0.5, yy + 0.5, 2, withAlpha(P.lantern, 110));
    });
    return c.scaled(4); // 64x48
}

function starPoints(cx, cy, outer, inner, rotation) {
    const points = [];
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + rotation + (i * Math.PI) / 5;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return points;
}

function drawStar(frame) {
    const c = new Canvas(16, 16);
    const outer = [6.5, 6, 6.5, 7][frame];
    const rotation = [0, 0.12, 0, -0.12][frame];
    c.poly(starPoints(8, 8.5, outer, outer * 0.45, rotation), P.lantern);
    c.poly(starPoints(8, 8.5, outer * 0.5, outer * 0.22, rotation), P.lanternHot);
    c.outline(P.ink);
    c.glow(8, 8.5, outer + 1.5, withAlpha(P.lanternHot, 120));
    return c.scaled(4); // 64x64
}

function drawNote(frame) {
    const c = new Canvas(16, 16);
    const bob = [0, -1, 0][frame];
    c.ellipse(6.5, 11.5 + bob, 3, 2.2, P.note1);
    c.set(7, 12 + bob, P.note0);
    c.set(8, 12 + bob, P.note0);
    c.set(5, 10 + bob, P.note2);
    c.rect(8, 3 + bob, 2, 9, P.note1);
    c.vline(9, 4 + bob, 11 + bob, P.note0);
    [[10, 3], [11, 4], [12, 5], [12, 6], [11, 7]].forEach(([x, y]) => c.set(x, y + bob, P.note1));
    c.outline(P.ink);
    c.glow(8, 8 + bob, 7, withAlpha(P.note2, 90 + frame * 20));
    return c.scaled(4); // 64x64
}

function drawHeart(frame) {
    const c = new Canvas(16, 16);
    const s = [5.8, 5.5, 5.2][frame];
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const u = (x + 0.5 - 8) / s;
            const v = -(y + 0.5 - 8.5) / s;
            const f = Math.pow(u * u + v * v - 1, 3) - u * u * v * v * v;
            if (f <= 0) c.set(x, y, u > 0.35 && v < 0 ? P.heart0 : P.heart1);
        }
    }
    c.disc(5.5, 6.5, 1.2, P.heart2);
    c.outline(P.ink);
    c.glow(8, 8.5, 8, withAlpha(P.heart2, 110));
    return c.scaled(4); // 64x64
}

function drawGem(frame) {
    const c = new Canvas(12, 12);
    c.poly([[6, 1], [10.5, 5], [6, 11], [1.5, 5]], P.gem1);
    c.poly([[6, 1], [10.5, 5], [6, 5]], P.gem2);
    c.poly([[6, 5], [10.5, 5], [6, 11]], P.gem0);
    const sparkle = [[4, 3], [8, 4], [6, 8], null][frame];
    if (sparkle) {
        const [sx, sy] = sparkle;
        c.set(sx, sy, P.white);
        c.set(sx - 1, sy, withAlpha(P.white, 150));
        c.set(sx + 1, sy, withAlpha(P.white, 150));
    }
    c.outline(P.ink);
    c.glow(6, 6, 6, withAlpha(P.gem2, 100));
    return c.scaled(4); // 48x48
}

function drawGolem(i) {
    const c = new Canvas(16, 16);
    const phase = i % 4;
    const bob = [0, 1, 0, 1][phase];
    c.poly([[4, 3 + bob], [12, 3 + bob], [13, 6 + bob], [13, 13], [3, 13], [3, 6 + bob]], P.golem1);
    c.rect(10, 5 + bob, 3, 8, P.golem0);
    c.vline(4, 5 + bob, 12, P.golem2);
    c.hline(5, 10, 3 + bob, P.moss1);
    c.set(6, 2 + bob, P.moss2);
    c.set(9, 2 + bob, P.moss1);
    const eye = i === 7 || i === 15 ? P.golem0 : P.lantern;
    c.set(5, 7 + bob, eye);
    c.set(8, 7 + bob, eye);
    c.set(7, 10, P.golem0);
    c.set(8, 11, P.golem0);
    const legs = [
        [4, 9],
        [5, 8],
        [6, 7],
        [5, 8],
    ][phase];
    c.rect(legs[0], 14, 3, 2, P.golem0);
    c.rect(legs[1], 14, 3, 2, P.golem0);
    c.outline(P.ink);
    return c.scaled(2); // 32x32 frame
}

function drawGolemSheet() {
    const sheet = new Canvas(128, 128);
    for (let i = 0; i < 16; i++) sheet.blit(drawGolem(i), (i % 4) * 32, Math.floor(i / 4) * 32);
    return sheet;
}

// ─────────────────────────────── tiles ───────────────────────────────

function stoneTile(seed) {
    const rng = mulberry32(seed);
    const c = new Canvas(16, 16);
    c.rect(0, 0, 16, 16, P.stone1);
    // staggered brick courses
    const courses = [
        { y0: 0, y1: 4, seams: [7] },
        { y0: 6, y1: 10, seams: [3, 12] },
        { y0: 12, y1: 15, seams: [8] },
    ];
    c.hline(0, 15, 5, P.stone0);
    c.hline(0, 15, 11, P.stone0);
    courses.forEach(({ y0, y1, seams }) => {
        seams.forEach((x) => c.vline(x, y0, y1, P.stone0));
        [0, ...seams.map((x) => x + 1)].forEach((x) => c.set(x, y0, P.stone2));
    });
    for (let k = 0; k < 6; k++) {
        c.set(Math.floor(rng() * 16), Math.floor(rng() * 16), rng() < 0.5 ? P.stone0 : P.stone2);
    }
    return c;
}

function addMossTop(c, seed) {
    const rng = mulberry32(seed);
    c.rect(0, 0, 16, 3, P.moss1);
    for (let x = 0; x < 16; x++) {
        if (rng() < 0.45) c.set(x, 0, P.moss2);
        const drip = rng();
        c.set(x, 3, drip < 0.6 ? P.moss0 : null);
        if (drip < 0.2) c.set(x, 4, P.moss0);
    }
}

function addLeftEdge(c) {
    c.vline(0, 0, 15, P.stone3);
    c.vline(1, 0, 15, P.stone2);
}

function addRightEdge(c) {
    c.vline(15, 0, 15, P.ink);
    c.vline(14, 0, 15, P.stone0);
}

function clearPixels(c, pixels) {
    pixels.forEach(([x, y]) => c.px.fill(0, (y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
}

function drawTiles() {
    const A = stoneTile(11);

    const B = stoneTile(12);
    addMossTop(B, 101);

    const C = stoneTile(13);
    addLeftEdge(C);

    const D = stoneTile(14);
    addRightEdge(D);

    const E = stoneTile(15);
    addLeftEdge(E);
    addMossTop(E, 102);
    c_vmoss(E, 0);
    clearPixels(E, [[0, 0], [1, 0], [0, 1]]);

    const F = stoneTile(16);
    addRightEdge(F);
    addMossTop(F, 103);
    c_vmoss(F, 15);
    clearPixels(F, [[15, 0], [14, 0], [15, 1]]);

    // where ground meets the foot of a wall: moss spills into the corner
    const G = stoneTile(17);
    addLeftEdge(G);
    [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2]].forEach(([x, y]) => G.set(x, y, P.moss1));
    G.set(0, 0, P.moss2);

    const H = stoneTile(18);
    addRightEdge(H);
    [[15, 0], [14, 0], [13, 0], [15, 1], [14, 1], [15, 2]].forEach(([x, y]) => H.set(x, y, P.moss1));
    H.set(15, 0, P.moss2);

    // wooden plank platform
    const I = new Canvas(16, 16);
    I.rect(0, 1, 16, 13, P.wood1);
    I.hline(0, 15, 1, P.wood2);
    I.hline(0, 15, 7, P.wood0);
    I.hline(0, 15, 13, P.wood0);
    I.vline(0, 1, 13, P.wood0);
    I.vline(9, 2, 6, P.wood0);
    I.vline(5, 8, 12, P.wood0);
    [[2, 3], [13, 3], [2, 10], [13, 10]].forEach(([x, y]) => I.set(x, y, P.stone3));
    I.hline(1, 15, 14, withAlpha(P.ink, 160));

    return { A, B, C, D, E, F, G, H, I };
}

function c_vmoss(c, x) {
    c.vline(x, 0, 4, P.moss1);
}

// ─────────────────────────────── backgrounds ───────────────────────────────

const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
];

function drawFarBackground() {
    const W = 400;
    const H = 150;
    const rng = mulberry32(2024);
    const c = new Canvas(W, H);
    const stops = [P.night0, P.night1, P.night2, P.dusk, P.horizon];
    for (let y = 0; y < H; y++) {
        const t = (y / (H - 1)) * (stops.length - 1);
        const i = Math.min(Math.floor(t), stops.length - 2);
        const f = t - i;
        for (let x = 0; x < W; x++) {
            c.set(x, y, f > (BAYER[y % 4][x % 4] + 0.5) / 16 ? stops[i + 1] : stops[i]);
        }
    }
    for (let k = 0; k < 170; k++) {
        const x = Math.floor(rng() * W);
        const y = Math.floor(rng() * 95);
        const bright = rng();
        c.set(x, y, withAlpha(bright < 0.2 ? P.lantern : P.white, 90 + Math.floor(bright * 165)));
        if (bright > 0.93) {
            [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => c.set(x + dx, y + dy, withAlpha(P.white, 110)));
        }
    }
    // moon with halo
    c.disc(130, 34, 26, withAlpha(P.moon, 18));
    c.disc(130, 34, 20, withAlpha(P.moon, 30));
    c.disc(130, 34, 14, P.moon);
    c.disc(125, 30, 3, P.moonShade);
    c.disc(135, 39, 2, P.moonShade);
    c.disc(133, 27, 1.5, P.moonShade);
    // two ridges of distant hills
    for (let x = 0; x < W; x++) {
        const far = 92 + 11 * Math.sin(x / 37) + 6 * Math.sin(x / 13 + 1) + 3 * Math.sin(x / 5.3);
        const near = 114 + 9 * Math.sin(x / 23 + 2) + 4 * Math.sin(x / 7.7);
        for (let y = Math.floor(far); y < H; y++) c.set(x, y, P.ridgeFar);
        for (let y = Math.floor(near); y < H; y++) c.set(x, y, P.ridgeNear);
    }
    // low mist
    for (let y = 120; y < H; y++) {
        c.hline(0, W - 1, y, withAlpha(P.horizon, Math.floor(((y - 120) / 30) * 70)));
    }
    return c.scaled(4); // 1600x600
}

function drawPine(c, x0, height, width) {
    const base = 150;
    c.rect(x0 - 1, base - Math.floor(height * 0.25), 3, Math.floor(height * 0.25), P.tree);
    for (let k = 0; k < 4; k++) {
        const top = base - height + k * height * 0.2;
        const bottom = top + height * 0.36;
        const half = width * (0.3 + 0.2 * k);
        c.poly([[x0 + 0.5, top], [x0 + half + 0.5, bottom], [x0 - half + 0.5, bottom]], P.tree);
    }
}

function drawNearBackground() {
    const W = 800;
    const H = 150;
    const rng = mulberry32(77);
    const c = new Canvas(W, H);
    let x = 6;
    while (x < W - 6) {
        drawPine(c, x, 45 + Math.floor(rng() * 50), 14 + Math.floor(rng() * 10));
        x += 18 + Math.floor(rng() * 28);
    }
    for (let xx = 0; xx < W; xx++) {
        const h = 130 + 5 * Math.sin(xx / 29) + 3 * Math.sin(xx / 11);
        for (let y = Math.floor(h); y < H; y++) c.set(xx, y, P.tree);
    }
    c.rim(1, 0, P.treeRim); // moonlight from the right
    for (let k = 0; k < 60; k++) {
        const fx = 4 + Math.floor(rng() * (W - 8));
        const fy = 55 + Math.floor(rng() * 80);
        c.disc(fx + 0.5, fy + 0.5, 2.5, withAlpha(P.lanternHot, 60));
        c.disc(fx + 0.5, fy + 0.5, 1.5, withAlpha(P.lantern, 130));
        c.set(fx, fy, P.lanternHot);
    }
    return c.scaled(4); // 3200x600
}

// ─────────────────────────────── audio ───────────────────────────────

const SAMPLE_RATE = 22050;

function writeWav(file, samples) {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(data.length, 40);
    fs.writeFileSync(file, Buffer.concat([header, data]));
}

const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);
const pulse = (phase, duty) => (phase % 1 < duty ? 1 : -1);
const triangle = (phase) => 4 * Math.abs((phase % 1) - 0.5) - 1;

// adds one note into buf with a simple attack/decay/release envelope
function addNote(buf, { start, duration, freq, wave, volume, attack = 0.01, release = 0.06, vibrato = 0, decay = 0 }) {
    const s0 = Math.floor(start * SAMPLE_RATE);
    const len = Math.floor((duration + release) * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < len && s0 + i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        let env = t < attack ? t / attack : 1;
        if (decay) env *= Math.exp(-t * decay);
        if (t > duration) env *= Math.max(0, 1 - (t - duration) / release);
        const f = freq * (1 + vibrato * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 4));
        phase += f / SAMPLE_RATE;
        buf[s0 + i] += wave(phase) * env * volume;
    }
}

function lowpass(buf, amount) {
    let y = 0;
    for (let i = 0; i < buf.length; i++) {
        y += amount * (buf[i] - y);
        buf[i] = y;
    }
}

function normalize(buf, peak) {
    const max = buf.reduce((m, s) => Math.max(m, Math.abs(s)), 0) || 1;
    for (let i = 0; i < buf.length; i++) buf[i] *= peak / max;
}

function composeMusic() {
    const BEAT = 60 / 96;
    const bars = 16;
    const buf = new Float32Array(Math.ceil(bars * 4 * BEAT * SAMPLE_RATE));
    const lead = new Float32Array(buf.length);

    // A minor lullaby: i - VI - III - VII - i - VI - VII - V
    const chords = [
        { root: 45, tones: [57, 60, 64] },
        { root: 41, tones: [57, 60, 65] },
        { root: 48, tones: [55, 60, 64] },
        { root: 43, tones: [55, 59, 62] },
        { root: 45, tones: [57, 60, 64] },
        { root: 41, tones: [57, 60, 65] },
        { root: 43, tones: [55, 59, 62] },
        { root: 40, tones: [56, 59, 64] },
    ];

    // [midi note or null for rest, beats]
    const melody = [
        [76, 1], [81, 1], [84, 1.5], [83, 0.5],
        [81, 2], [79, 1], [76, 1],
        [79, 1], [76, 1], [74, 1], [76, 1],
        [74, 3], [null, 1],
        [76, 1], [81, 1], [83, 1], [84, 1],
        [86, 1.5], [84, 0.5], [81, 2],
        [83, 1], [79, 1], [86, 1], [83, 1],
        [80, 2], [83, 1], [76, 1],
        [84, 1], [83, 0.5], [81, 0.5], [76, 2],
        [77, 1], [81, 1], [84, 2],
        [88, 1.5], [86, 0.5], [84, 1], [79, 1],
        [83, 2], [86, 2],
        [84, 1], [81, 1], [76, 1], [81, 1],
        [84, 1], [77, 1], [81, 1], [84, 1],
        [83, 1.5], [81, 0.5], [79, 1], [83, 1],
        [80, 2], [76, 2],
    ];

    for (let bar = 0; bar < bars; bar++) {
        const chord = chords[bar % 8];
        const t0 = bar * 4 * BEAT;
        // bass
        [
            [0, 1, 0],
            [1, 0.5, 12],
            [1.5, 0.5, 0],
            [2, 1, 7],
            [3, 1, 0],
        ].forEach(([beat, len, interval]) =>
            addNote(buf, {
                start: t0 + beat * BEAT,
                duration: len * BEAT * 0.8,
                freq: midiToFreq(chord.root + interval),
                wave: triangle,
                volume: 0.38,
            })
        );
        // eighth-note arpeggio
        for (let e = 0; e < 8; e++) {
            const note = chord.tones[[0, 1, 2, 1, 0, 1, 2, 1][e]] + (e >= 4 && bar % 2 ? 12 : 0);
            addNote(buf, {
                start: t0 + e * 0.5 * BEAT,
                duration: 0.5 * BEAT * 0.5,
                freq: midiToFreq(note),
                wave: (p) => pulse(p, 0.25),
                volume: 0.07,
                decay: 6,
            });
        }
        // soft off-beat shaker
        const rng = mulberry32(bar + 1);
        for (let e = 1; e < 8; e += 2) {
            const s0 = Math.floor((t0 + e * 0.5 * BEAT) * SAMPLE_RATE);
            for (let i = 0; i < 900 && s0 + i < buf.length; i++) {
                buf[s0 + i] += (rng() * 2 - 1) * 0.05 * Math.exp(-i / 180);
            }
        }
    }

    let t = 0;
    melody.forEach(([note, beats]) => {
        if (note !== null) {
            addNote(lead, {
                start: t,
                duration: beats * BEAT * 0.9,
                freq: midiToFreq(note),
                wave: (p) => pulse(p, 0.5),
                volume: 0.16,
                attack: 0.02,
                release: 0.12,
                vibrato: 0.006,
            });
        }
        t += beats * BEAT;
    });
    lowpass(lead, 0.35);
    for (let i = 0; i < buf.length; i++) buf[i] += lead[i];
    // fade the last few ms so the loop point doesn't click
    const tail = Math.floor(0.03 * SAMPLE_RATE);
    for (let i = 0; i < tail; i++) buf[buf.length - 1 - i] *= i / tail;
    normalize(buf, 0.85);
    return buf;
}

function composePrize() {
    const buf = new Float32Array(Math.floor(0.6 * SAMPLE_RATE));
    [76, 80, 83, 88].forEach((note, i) => {
        const last = i === 3;
        addNote(buf, {
            start: i * 0.06,
            duration: last ? 0.3 : 0.06,
            freq: midiToFreq(note),
            wave: (p) => pulse(p, 0.5),
            volume: 0.3,
            attack: 0.003,
            release: last ? 0.15 : 0.02,
            decay: last ? 7 : 0,
        });
        addNote(buf, {
            start: i * 0.06,
            duration: last ? 0.3 : 0.06,
            freq: midiToFreq(note + 12) * 1.003,
            wave: triangle,
            volume: 0.15,
            attack: 0.003,
            decay: 9,
        });
    });
    lowpass(buf, 0.5);
    normalize(buf, 0.8);
    return buf;
}

function composeBoop() {
    const len = Math.floor(0.22 * SAMPLE_RATE);
    const buf = new Float32Array(len);
    const rng = mulberry32(9);
    let phase = 0;
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const freq = 90 + 330 * Math.exp(-t * 22); // pitch drops like a squish
        phase += freq / SAMPLE_RATE;
        buf[i] = triangle(phase) * Math.exp(-t * 14) * 0.9;
        if (t < 0.03) buf[i] += (rng() * 2 - 1) * 0.35 * (1 - t / 0.03);
    }
    lowpass(buf, 0.45);
    normalize(buf, 0.85);
    return buf;
}

function composeClang() {
    // the stomp that does not land: a hard, bright knock with an inharmonic
    // partial so it reads as armour rather than as the squish of a kill
    const len = Math.floor(0.2 * SAMPLE_RATE);
    const buf = new Float32Array(len);
    const rng = mulberry32(21);
    let low = 0;
    let ring = 0;
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        low += (150 + 60 * Math.exp(-t * 30)) / SAMPLE_RATE;
        ring += 404 / SAMPLE_RATE; // deliberately not a harmonic of the body
        buf[i] = (triangle(low) * 0.55 + pulse(ring, 0.5) * 0.25) * Math.exp(-t * 26);
        if (t < 0.012) buf[i] += (rng() * 2 - 1) * 0.5 * (1 - t / 0.012); // the strike
    }
    lowpass(buf, 0.7);
    normalize(buf, 0.8);
    return buf;
}

// ─────────────────────────────── output ───────────────────────────────

function savePNG(name, canvas) {
    fs.writeFileSync(path.join(IMAGES, name), encodePNG(canvas));
    console.log(`  ${name.padEnd(26)} ${canvas.w}x${canvas.h}`);
}

function main() {
    fs.mkdirSync(IMAGES, { recursive: true });
    fs.mkdirSync(SOUNDS, { recursive: true });

    console.log("images:");
    [0, 1, 2].forEach((f) => savePNG(`player${f + 1}.png`, drawPlayer(f)));
    [0, 1].forEach((f) => savePNG(`grub${f + 1}.png`, drawSlime(f)));
    [0, 1, 2].forEach((f) => savePNG(`fly${f + 1}.png`, drawBat(f)));
    [0, 1].forEach((f) => savePNG(`stalker${f + 1}.png`, drawStalker(f)));
    savePNG("stalkerAlert.png", drawStalkerAlert());
    [0, 1].forEach((f) => savePNG(`stalkerStunned${f + 1}.png`, drawStalkerStunned(f)));
    [0, 1, 2, 3].forEach((f) => savePNG(`star${f + 1}.png`, drawStar(f)));
    [0, 1, 2].forEach((f) => savePNG(`music${f + 1}.png`, drawNote(f)));
    [0, 1, 2].forEach((f) => savePNG(`heart${f + 1}.png`, drawHeart(f)));
    [0, 1, 2, 3].forEach((f) => savePNG(`powerup${f + 1}.png`, drawGem(f)));
    savePNG("spritesheet_caveman.png", drawGolemSheet());
    Object.entries(drawTiles()).forEach(([name, tile]) => savePNG(`tile_${name}.png`, tile.scaled(4)));
    savePNG("background.png", drawFarBackground());
    savePNG("background2.png", drawNearBackground());

    console.log("sounds:");
    writeWav(path.join(SOUNDS, "music.wav"), composeMusic());
    writeWav(path.join(SOUNDS, "prize.wav"), composePrize());
    writeWav(path.join(SOUNDS, "boop2.wav"), composeBoop());
    writeWav(path.join(SOUNDS, "clang.wav"), composeClang());
    ["music.wav", "prize.wav", "boop2.wav", "clang.wav"].forEach((f) => {
        console.log(`  ${f.padEnd(26)} ${fs.statSync(path.join(SOUNDS, f)).size} bytes`);
    });
}

main();
