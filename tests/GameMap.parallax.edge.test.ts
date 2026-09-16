import { describe, it, expect } from "vitest";
import { computeParallaxX } from "../src/GameMap";

// Edge cases and regression guards for computeParallaxX, complementing the
// provided tests in GameMap.parallax.test.ts (which must stay unmodified).
//
// The camera offset for the tiles ranges from 0 (left edge of the map) down to
// myW - mapWidth (right edge). A background layer of width bgWidth must travel
// proportionally from 0 down to myW - bgWidth over that same range.

const VIEW_W = 800;

describe("computeParallaxX edge cases", () => {
    describe("single-screen map (mapWidth === myW)", () => {
        it("returns 0 instead of NaN when the map is exactly one screen wide", () => {
            const x = computeParallaxX(0, VIEW_W, VIEW_W, 1600);
            expect(Number.isNaN(x)).toBe(false);
            expect(x).toBe(0);
        });

        it("keeps every layer width stationary on a single-screen map", () => {
            for (const bgWidth of [400, 800, 1600, 3200]) {
                expect(computeParallaxX(0, VIEW_W, VIEW_W, bgWidth)).toBe(0);
            }
        });
    });

    describe("layer speed relative to the tiles", () => {
        it("a layer exactly as wide as the viewport never scrolls", () => {
            for (const offsetX of [0, -300, -1200, -2400]) {
                expect(computeParallaxX(offsetX, VIEW_W, 3200, VIEW_W)).toBe(0);
            }
        });

        it("a layer as wide as the map scrolls at the same speed as the tiles", () => {
            for (const offsetX of [0, -300, -1200, -2400]) {
                expect(computeParallaxX(offsetX, VIEW_W, 3200, 3200)).toBe(offsetX);
            }
        });

        it("the smaller (farther) layer scrolls slower than the larger (nearer) layer", () => {
            // map1 uses bg1 (1600px) behind bg2 (3200px)
            for (const offsetX of [-100, -800, -2000]) {
                const far = computeParallaxX(offsetX, VIEW_W, 4160, 1600);
                const near = computeParallaxX(offsetX, VIEW_W, 4160, 3200);
                expect(Math.abs(far)).toBeLessThan(Math.abs(near));
            }
        });

        it("reaches the layer's right edge exactly when the camera reaches the map's right edge", () => {
            const mapWidth = 64 * 97; // map2 is 97 tiles wide
            for (const bgWidth of [1600, 3200]) {
                expect(computeParallaxX(VIEW_W - mapWidth, VIEW_W, mapWidth, bgWidth)).toBe(
                    VIEW_W - bgWidth
                );
            }
        });
    });

    describe("numeric robustness", () => {
        it("never returns negative zero at the left edge", () => {
            // A layer narrower than the viewport flips the sign of the ratio,
            // which would otherwise produce -0 at offsetX = 0.
            expect(Object.is(computeParallaxX(0, VIEW_W, 3200, 400), 0)).toBe(true);
        });

        it("returns whole pixels so the layer is never drawn on a sub-pixel boundary", () => {
            const x = computeParallaxX(-1001, VIEW_W, 3200, 1600);
            expect(Number.isInteger(x)).toBe(true);
        });

        it("stays finite when the map is narrower than the viewport", () => {
            // GameMap.draw clamps offsetX to myW - mapWidth, which is positive here
            const mapWidth = 640;
            const x = computeParallaxX(VIEW_W - mapWidth, VIEW_W, mapWidth, 1600);
            expect(Number.isFinite(x)).toBe(true);
        });
    });
});
