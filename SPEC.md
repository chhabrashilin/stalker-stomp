# Feature Spec: the Stalker enemy

**Author:** niazy · **Task:** T5 (new feature) + T6 (unit tests) · **Branch:** `niazy/new-enemy-type`

---

## 1. Motivation

The game ships with two enemies, and neither is aware of anything:

```ts
export class Grub extends Creature {
    getMaxSpeed() { return 0.05; }
}

export class Fly extends Creature {
    isFlying() { return this.state == CreatureState.NORMAL; }
    getMaxSpeed() { return 0.2; }
}
```

That is their entire subclass surface. Both move blindly in one direction until a
wall reverses them via the inherited `Sprite.collideHorizontal()`, and both are
defeated the same way: land on top, and `GameMap.checkPlayerCollision` kills them.

The **Stalker** is behaviourally distinct on both axes:

- It is the first enemy that **reacts to the player** — it detects, telegraphs,
  and charges, via a four-phase state machine.
- It is the first enemy the player **cannot simply stomp** — it is only
  vulnerable during the recovery window after a charge. A mistimed stomp bounces
  harmlessly off its armour.

It is also the first enemy whose behaviour is worth unit-testing, because the
phase logic is pure timer-and-position arithmetic with no p5 dependency.

---

## 2. Behaviour

### 2.1 State machine

```
        detects player                after ALERT_TIME
PATROL ────────────────► ALERT ──────────────────────► CHARGE
  ▲   vx = facing·0.05    vx = 0                   vx = facing·0.32
  │                                                       │
  │                                                       │ hits a wall
  │              after STUN_TIME                          │ OR CHARGE_TIME elapses
  └──────────────────────── STUNNED ◄─────────────────────┘
                             vx = 0
                          ** vulnerable **
```

`StalkerPhase` is a separate enum from `CreatureState`. The phase machine only
runs while `state === CreatureState.NORMAL`; entering `DYING` resets the phase to
`PATROL` and clears every timer.

### 2.2 Detection

The Stalker enters `ALERT` when **all** of the following hold:

| Condition | Rationale |
|---|---|
| It was on screen last frame | Can't be charged by something you've never seen |
| `turnBlindTime <= 0` | The fairness beat — see §2.4 |
| A target is set | See §4.2 |
| `sign(dx) === facing` | Front only, so it can be snuck up on from behind |
| `abs(dx) <= DETECT_X` (4 tiles) | Ranged, not the whole visible screen |
| `abs(dy) <= DETECT_Y` (1 tile) | Must be on roughly the same level |

"On screen" reuses the engine's existing visibility signal rather than inventing
one: `GameMap.draw()` already calls `wakeUp()` on every `Creature` whose x falls
inside the 800px viewport. `Stalker.wakeUp()` records that. This keeps all camera
knowledge out of the class. Because `draw()` runs after `update()`, the flag is
consumed one frame later than it is set — a deliberate, documented one-frame lag.

Detection compares **positions only**, never image dimensions. That is both a
design choice (it stays a pure predicate) and a testability requirement: a bare
`new Stalker()` has no animation frames, so `getImage()` returns `null` under
test. Positions are sprite *top* edges; the ±1 tile vertical band absorbs the
height difference between sprites standing on the same floor.

### 2.3 Charging

A charge ends when it hits a wall **or** when `CHARGE_TIME` elapses, and **both
outcomes lead to `STUNNED`**. This is deliberate rather than incidental: if a
timed-out charge returned straight to `PATROL`, the Stalker would be *unkillable*
on open ground, because its only vulnerable window would depend on the level
happening to provide a wall. Sharing the outcome gives the player one rule that
holds everywhere — **bait the charge, then stomp**.

Mechanically the two differ in one respect that must be handled. The inherited
`Sprite.collideHorizontal()` *reverses* velocity, which at charge speed would
fire the Stalker backwards across the screen. `Stalker` overrides it:

```ts
collideHorizontal() {
    if (this.phase === StalkerPhase.CHARGE) {
        this.enterPhase(StalkerPhase.STUNNED);   // vx = 0, no bounce
        return;
    }
    super.collideHorizontal();                    // normal patrol bounce
    this.facing = -this.facing;
    this.turnBlindTime = TURN_BLIND_TIME;
}
```

The Stalker can run off a ledge mid-charge and fall, exactly as a Grub does —
gravity applies (`isFlying()` stays false) and the charge still ends on its timeout.

### 2.4 The fairness beat

Consider: a Stalker bounces off a wall, its facing flips toward a player standing
one tile away, and it charges instantly. That reads as cheating even though the
rules were followed. Two explicit delays prevent it:

1. **`TURN_BLIND_TIME` (400ms)** — after *any* facing change it cannot acquire a
   target at all.
2. **`ALERT_TIME` (300ms)** — the tell. It stops dead before charging.

Minimum time from facing-flip to charge: **700ms**, of which the last 300ms is a
visible stop. Test 29 pins this sum so it can't be eroded by retuning one number.

---

## 3. Player interaction

### 3.1 Contact outcomes

`GameMap.checkPlayerCollision` currently has two outcomes. The Stalker needs a
third. Rather than bolt a branch onto the side, the decision is delegated to the
creature and the caller becomes a flat dispatch — one branch *shallower* than the
`if (canKill)` nesting it replaces:

```ts
export enum StompResult { KILLS_CREATURE, BLOCKED, KILLS_PLAYER }

// Creature — the default reproduces today's behaviour exactly
resolvePlayerContact(fromAbove: boolean): StompResult {
    return fromAbove ? StompResult.KILLS_CREATURE : StompResult.KILLS_PLAYER;
}
```

```ts
// Stalker
resolvePlayerContact(fromAbove: boolean): StompResult {
    if (this.blockGraceTime > 0) return StompResult.BLOCKED;
    if (!fromAbove) return StompResult.KILLS_PLAYER;
    return this.phase === StalkerPhase.STUNNED
        ? StompResult.KILLS_CREATURE
        : StompResult.BLOCKED;
}
```

`Grub` and `Fly` inherit the default and are behaviourally untouched. Tests 1–4
pin that as a regression guard.

### 3.2 Making "blocked" read as blocked

A blocked bounce must not look like a successful stomp the enemy survived.

- **Height:** `BLOCK_BOUNCE = 0.45 × JUMP_SPEED`. Since height scales with v²,
  that is roughly **one fifth** the height of a real stomp bounce.
- **Sound:** a distinct thud, separate from the `boop` stomp-kill sound.
- **No score popup**, where a real stomp floats a `+points` label.

Horizontal knockback was considered and is **not possible** without a larger
change: `GameManager.processActions()` sets `vel.x = 0` every frame while Running
before applying input, so any sideways push is erased in the same frame.

### 3.3 The blocked-stomp hazard

A normal stomp is safe only because the stomped creature immediately becomes
`DYING`, and `GameMap.isCollision()` returns `false` for any non-NORMAL creature —
so the overlap stops mattering instantly.

A **blocked** Stalker stays `NORMAL`. The player is still overlapping it and is
now moving *upward*, so on the next axis update `canKill` is `false` (they are no
longer falling) and the contact resolves as `KILLS_PLAYER`. **The forgiving
option is the lethal one** unless this is handled. Two mitigations, both tested:

1. The player is repositioned on top of the Stalker, exactly as a real stomp does.
2. `BLOCK_GRACE_TIME` (250ms) — for a quarter second after a block, *all* contact
   with that Stalker resolves as `BLOCKED`, in either direction.

---

## 4. Integration

### 4.1 Where the new code goes

| File | Change |
|---|---|
| `src/sprites/Stalker.ts` | **New.** The class, its phase enum, its constants |
| `src/sprites/Creature.ts` | `StompResult` enum; `resolvePlayerContact()`, `onBlocked()`, `stompValue()` hooks with today's behaviour as the default |
| `src/GameMap.ts` | Flat dispatch in `checkPlayerCollision`; exported `assignTargets()`; load the thud |
| `src/ScoreKeeper.ts` | `stomp()` gains a default parameter |
| `src/ResourceManager.ts` | `case "Stalker"` in `buildSprite` |
| `assets/resources/resources.json` | `stalker` sprite entry; `"3": "stalker"` mapping |
| `assets/assets.json` | Stalker frames; thud WAV |
| `assets/maps/map{1,2,3}.txt` | Place `3` characters |

### 4.2 How the Stalker sees the player

Nothing in the sprite hierarchy knows about any other sprite — `Creature.update(deltaTime)`
takes only elapsed time. The Stalker is handed the player once, at spawn.

The obvious implementation is wrong in a way worth recording. `GameMap.initialize()`
assigns `this.player` *inside* the same top-to-bottom parse loop that creates
enemies:

```ts
if (ch == "0") { this.player = s; } else { this.sprites.push(s); }
```

In all three maps the player sits on the second-to-last row, below almost every
enemy. A `setTarget(this.player)` call made inline would therefore hand
`undefined` to nearly every Stalker — a bug whose visible symptom ("some
stalkers just don't work") varies with map layout and looks nothing like its
cause. Targets are assigned in a **second pass**, after parsing completes:

```ts
export function assignTargets(sprites: Sprite[], player: Sprite): void {
    sprites.forEach((s) => { if (s instanceof Stalker) s.setTarget(player); });
}
```

It is exported as a pure function — the same shape as the existing
`computeParallaxX` — so it is directly unit-testable without constructing a
`GameMap`. Tests 40–42 cover it, including the array-order case specifically.

### 4.3 Cloning

`Sprite.clone()` does `new (this.constructor as any)()` and then copies only
`position`, `velocity`, `animations`, `currAnimName`, `currAnimation`;
`Creature.clone()` adds `state` and `stateTime`. **Any field not on that list
silently reverts to its constructor default.** `Stalker` therefore overrides
`clone()` to carry `phase`, `phaseTime`, `facing`, `turnBlindTime`,
`blockGraceTime`, and `target`.

Note the target interaction is benign, but for the opposite reason to the obvious
one: `GameMap.initialize()` clones the *prototype* held by `ResourceManager`,
never a live instance, and the prototype never has a target. Clones are not
losing a good reference — they never had one. §4.2's second pass is what supplies
it. Test 7 documents this rather than pretending it cannot happen.

### 4.4 A missing target is loud

If a Stalker reaches `update()` with no target, that is a wiring or level-authoring
mistake. It emits a `console.error` naming both the cause and the fix, and then
degrades to plain Grub-style patrol so the level stays playable.

The error is **flag-guarded to fire once per instance**. An unguarded one would
fire sixty times a second and scroll its own explanation off the console, which is
its own kind of silence. Tests 8–10 assert it fires, fires exactly once, and does
not throw.

### 4.5 `wakeUp()` must be overridden

`GameMap.draw()` calls `wakeUp()` every frame on every on-screen `Creature`, and
the base implementation force-sets `vx = -getMaxSpeed()` whenever `vx == 0`:

```ts
wakeUp() {
    if (this.getState() == CreatureState.NORMAL && this.velocity.x == 0) {
        this.setVelocity(-this.getMaxSpeed(), 0);
    }
}
```

A Stalker standing still during its tell (`ALERT`) or its stun (`STUNNED`) has
`vx == 0`. Unoverridden, the base method would overwrite the state machine sixty
times a second. `Stalker.wakeUp()` records the on-screen flag and defers to
`super` **only** in `PATROL`. Tests 17–19 pin all three phases.

Relatedly, entering `PATROL` sets `vx = facing * PATROL_SPEED` explicitly rather
than leaving it at zero for `wakeUp()` to kick, so a Stalker recovering from a
stun resumes in the direction it is facing instead of always snapping left.

---

## 5. Scoring

The Stalker goes through the same `KILLS_CREATURE` path as any other enemy, so it
scores automatically; suppressing that would be extra code for a worse outcome. It
is also strictly harder to kill than a Grub — you must bait a charge and land
inside an 800ms window — so it pays more.

**A Stalker kill is worth 3× a Grub (600 base), and scales with the stomp chain
like everything else.** A chained Stalker kill can pay 600–4800.

The weight lives on the sprite, the points live in the scoring layer:

```ts
// Creature: a dimensionless weight, not a point total
stompValue(): number { return 1; }
// Stalker
stompValue(): number { return 3; }
```
```ts
// GameMap
this.showPoints(s, this.score.stomp(POINTS.STOMP * s.stompValue()));
```

This keeps the sprite hierarchy free of any `ScoreKeeper` import, and stays
polymorphic like `resolvePlayerContact` rather than mixing in an `instanceof`.

`ScoreKeeper.stomp()` gains a **default parameter**, so every existing call site
and all 18 `ScoreKeeper.test.ts` cases — which all call it bare — are unaffected:

```ts
stomp(base: number = POINTS.STOMP): number { ... }
```

### Blocked stomps and the chain

A blocked stomp awards nothing and **does not break the chain**. A block is
"nothing happened", so it carries no penalty beyond the failed kill. This needs
no code: `ScoreKeeper.land()` only fires when `player.onGround`, and a blocked
bounce leaves the player airborne.

One consequence is intentional and worth stating plainly: because the bounce keeps
the player airborne, a skilled player can use an armoured Stalker as a
**trampoline** to extend a chain onto nearby enemies. Each bounce pays zero and
the multiplier caps at 8×, so this is skill expression, not an exploit.

---

## 6. Tuning

All distances given in tiles (`TILE_SIZE = 64`).

| Constant | Value | In tiles |
|---|---|---|
| `PATROL_SPEED` | 0.05 px/ms | 0.8 tiles/s — *identical to Grub, so it reads as one until it notices you* |
| `DETECT_X` | 256 px | 4 tiles ahead |
| `DETECT_Y` | 64 px | ±1 tile |
| `ALERT_TIME` | 300 ms | the tell |
| `CHARGE_SPEED` | 0.32 px/ms | 5 tiles/s |
| `CHARGE_TIME` | 1000 ms | covers exactly **5 tiles** unobstructed |
| `STUN_TIME` | 800 ms | the vulnerable window |
| `TURN_BLIND_TIME` | 400 ms | after any facing flip |
| `BLOCK_GRACE_TIME` | 250 ms | after a blocked stomp |
| `BLOCK_BOUNCE` | 0.45 × `JUMP_SPEED` | ≈ 1/5 the height of a real stomp bounce |
| `STALKER_STOMP_VALUE` | 3 | 600 base points |

Derived properties, each pinned by a test so retuning one number cannot silently
break the design:

- The player's top speed is 0.5 px/ms (**7.8 tiles/s**) against a charge's 5
  tiles/s — **the player can outrun a charge.**
- Detection reach (4 tiles) is shorter than charge reach (5 tiles), so it catches
  a stationary player but loses a running one.
- Facing-flip to charge is never less than 700ms.

`getMaxSpeed()` returns `PATROL_SPEED` in every phase — it keeps its existing
meaning of "normal movement speed", which is what `wakeUp()` uses. Charge speed is
a separate constant applied explicitly on entering `CHARGE`.

---

## 7. Assets

| Asset | Requirement |
|---|---|
| `stalker` sprite entry | `"type": "Stalker"` and **all four** anim keys: `left`, `right`, `deadLeft`, `deadRight` |
| Frames | Every frame of the sprite must be the same pixel size |
| Thud sound | A **genuine** `.wav` — `RIFF`/`WAVE` headers with a non-zero data chunk |
| Map character | `3` (verified still free: current mappings are `o ! * 1 2 0 ^ -`) |

All four anim keys are mandatory, not stylistic: `Creature.update()` switches to
`left`/`right` by velocity sign and `setState(DYING)` switches to
`deadLeft`/`deadRight`. A missing key leaves `currAnimation === undefined` and the
next `update()` throws.

### Constraints imposed by `tests/assets.maps.test.ts`

That suite validates the manifests and every level, so the asset work has to
respect it. Checked against all 22 of its cases:

- **Reachability is unaffected.** `isSolid()` only treats `/[A-Z]/` as solid, so
  `3` reads as empty air — enemies are invisible to the level-completion model.
- **`3` must overwrite a space, never be inserted.** Rows are uniform width
  (map1/map2 = 84, map3 = 104) and the "wide enough to scroll" check depends on it.
- **Never on the bottom row** — "has a solid floor all the way across".
- **The mapping must land before the map edits.** The allowed-character set is
  built from `Object.keys(resources.maps.mappings)`; adding `3` to a map first
  fails all three levels.
- **Every referenced file must exist**, and all frames of one sprite must share a
  pixel size.
- **The thud cannot be stubbed** — the suite reads the WAV header and asserts a
  non-zero data length.

### Placement

Place `3` on ground runs with a wall within about 5 tiles, so a charge has
something to slam into and the vulnerable window is reachable. Add `3 stalker` to
each map's `#` legend (comment lines are filtered out, so they cost no width).

### Placeholder art — to be replaced

Initial wiring points the `stalker` entry at the existing grub frames so the
feature is playable and every asset test passes immediately. **This is a
placeholder.** Distinct art is T7 work and must land before submission, or the
Stalker is visually indistinguishable from a Grub — which would undermine the
entire design, since the player is meant to read its tell.

---

## 8. Test plan

New `tests/Stalker.test.ts`, plus additions to `tests/Creature.test.ts` and
`tests/GameMap.score.test.ts`.

Every case constructs real objects and asserts on behaviour. **No production
logic is copied into a test file** — the existing `GameMap.isCollision.test.ts`
re-implements `isCollision` in the test, which lets the copy drift from the real
code; this suite deliberately does not repeat that. Nothing needs p5 beyond the
`createVector` and `deltaTime` stubs already in `tests/setup.ts`. A fake target is
a plain `{ getPosition: () => ({ x, y }) }`, following the `makeFakePlayer`
pattern in `tests/GameManager.lives.test.ts`.

**Regression guard on existing enemies** — `tests/Creature.test.ts`, appended;
existing cases untouched:

1. `new Grub().resolvePlayerContact(true)` → `KILLS_CREATURE`
2. `new Grub().resolvePlayerContact(false)` → `KILLS_PLAYER`
3. The same two for `Fly`
4. `new Grub().stompValue()` → 1, and `onBlocked()` is a harmless no-op

**Construction and cloning**

5. Starts `PATROL`, `phaseTime` 0, `facing` -1, `getMaxSpeed()` 0.05, `isFlying()` false
6. `clone()` carries `phase`, `phaseTime`, `facing`, `turnBlindTime`, `blockGraceTime`
7. A clone of a fresh prototype has no target (documents §4.3)

**A missing target is loud** (§4.4)

8. `update()` with no target emits a `console.error` and does **not** throw
9. Repeated `update()` emits it exactly **once**, not once per frame
10. With no target it stays in `PATROL` and keeps moving — degrades, doesn't freeze

**Detection predicate** — position-only

11. In front, 3 tiles away, same row, on screen → true
12. Behind (opposite side to `facing`) → false
13. In front but 5 tiles away → false
14. In front, 2 tiles away, but 2 tiles below → false
15. Off screen (`wakeUp()` not called this frame) → false
16. Inside `turnBlindTime` → false even when otherwise in range

**`wakeUp()` override** (§4.5)

17. `PATROL` with `vx == 0` → kicked to `-PATROL_SPEED` (base behaviour preserved)
18. `ALERT` → `vx` stays 0; the tell is not overwritten
19. `STUNNED` → `vx` stays 0; the vulnerable window is not overwritten

**Phase machine**

20. `PATROL` + detect → `ALERT`, `vx == 0`
21. `ALERT` holds `vx == 0` for 300ms; at 301ms → `CHARGE`
22. Entering `CHARGE`, `abs(vx) == CHARGE_SPEED` and its sign matches `facing`
23. `CHARGE` → `STUNNED` after `CHARGE_TIME`, `vx == 0`
24. `collideHorizontal()` during `CHARGE` → `STUNNED` immediately, `vx == 0`
    (**not** the inherited velocity reversal)
25. `collideHorizontal()` during `PATROL` → inherited bounce, `vx` reversed,
    `facing` flipped
26. `STUNNED` → `PATROL` after `STUN_TIME`, `vx` set from `facing` (not forced left)
27. Full cycle `PATROL→ALERT→CHARGE→STUNNED→PATROL` over accumulated `update()` calls
28. `CHARGE_SPEED * CHARGE_TIME === 5 * 64` — pins the "5 tiles" claim
29. `TURN_BLIND_TIME + ALERT_TIME === 700` — pins the fairness beat

**Contact resolution**

30. `resolvePlayerContact(true)` in `STUNNED` → `KILLS_CREATURE`
31. `resolvePlayerContact(true)` in `PATROL` / `ALERT` / `CHARGE` → `BLOCKED` (3 cases)
32. `resolvePlayerContact(false)` → `KILLS_PLAYER` in every phase
33. After `onBlocked()`, `resolvePlayerContact(false)` → `BLOCKED` for 250ms
    (the §3.3 rising-player death)
34. After the grace expires → `KILLS_PLAYER` again

**Scoring** — `tests/GameMap.score.test.ts`, appended, reusing its existing
`makeBareMap` and `withFrames` helpers

35. Stomping a `STUNNED` Stalker awards `POINTS.STOMP * 3` and floats that label
36. A Stalker kill scales with the chain (grub then stalker → 200, then 1200)
37. A blocked stomp awards nothing, kills neither party, leaves the Stalker `NORMAL`
38. A blocked stomp does **not** reset the chain — a following stomp still doubles
39. `ScoreKeeper.stomp()` with no argument is unchanged (guards the default parameter)

**Target wiring** (§4.2)

40. `assignTargets(sprites, player)` sets the target on every Stalker
41. It leaves non-Stalker sprites untouched (`Grub`, `Fly`, `Star`)
42. It works when the Stalker **precedes** the player in the array — the
    map-row-order bug, pinned

**Death interaction**

43. `setState(DYING)` zeroes velocity and resets the phase to `PATROL`
44. A Stalker killed mid-`CHARGE` still reaches `DEAD` after `DIE_TIME`

---

## 9. Verification

Baseline before this work: **11 test files, 154 tests, all passing.**

1. `npm run test` — new cases green and all 154 existing tests still passing, in
   particular the 15 in `GameMap.score.test.ts`, the 18 in `ScoreKeeper.test.ts`,
   and the 22 in `assets.maps.test.ts`. Existing tests are not deleted or
   weakened (R6).
2. `npm run format:check && npm run lint` — both run in CI.
3. `npx tsc` — the `pages` job compiles. Intra-`src` imports must carry the `.js`
   extension or the browser build breaks even though vitest passes.
4. `npm run start`, then in the running game:
   - The Stalker patrols like a Grub, stops and telegraphs when approached from
     the front, charges, and slams into a wall.
   - It is killable **only** during recovery.
   - **A mistimed stomp bounces the player without killing them.** §3.3 shows this
     path is silently lethal if the grace window is wrong, so it must be confirmed
     in the running game, not only in tests.
   - Approaching from behind does not trigger it.
   - A wall-bounce next to the player does not produce an instant charge.
   - The HUD shows +600 for a Stalker kill; a blocked bounce shows no popup and
     does not reset the multiplier.
   - Existing Grub and Fly stomps, deaths, and scores are unchanged.

## 10. Explicitly out of scope

- **T9 instructions modal** — the Stalker adds no key bindings, so the controls
  text stays accurate.
- **A pre-existing bug in `GameMap.update()`**: `obj.splice(index, 1)` inside a
  `forEach` skips the following sprite on the frame a creature dies. It is real,
  but it predates this work and belongs on its own branch under T1's
  one-logical-change-per-branch rule.
