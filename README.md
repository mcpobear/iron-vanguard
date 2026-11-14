# IRON VANGUARD

A mobile-first, single-player tactical tank platoon game set in the War of the Broken Frontier (a fictional 1944).
Command four A-44 Sentinel tanks of Vanguard 1 Platoon. Each tank has a persistent commander who can be promoted,
decorated or permanently killed.

**Three playable missions:** *The Battle of Bellwick* (15–20 min), *The Kessler Ridge Gauntlet* (20–30 min) and *Last Stand at Ardenne Farm* (8–12 min).

> "Machines can be replaced. The men who command them cannot."

The version shown on the main menu comes from `package.json` — bump `version` there and it updates everywhere.

## Quick start

```bash
npm install
npm run dev       # http://localhost:5173 (also reachable from your phone on the same Wi-Fi via the printed Network URL)
npm test          # campaign-logic unit tests (succession, casualties, XP, saves)
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build locally
```

Node 18+ is required (20 or 22 recommended).

## Deploying to GitHub Pages

1. Create a GitHub repository (for example `iron-vanguard`) and push this folder to the `main` branch.
2. On GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`, which installs, runs the tests, builds and publishes `dist/`.
4. The game will be at `https://<your-username>.github.io/<repo-name>/`.

The Vite `base` is `./`, so the build works from any sub-path without changes.
On a phone, use **Add to Home Screen** for a full-screen, app-like launch (a web manifest and icons are included).

## Controls

| Action | Touch (primary) | Keyboard & mouse (optional) |
|---|---|---|
| Drive | Floating joystick: touch anywhere on the left side and drag. The finger can leave the stick graphic. | W A S D |
| Look / turret | Drag on the right side of the screen. The turret follows the view. | Mouse (click to capture) |
| Zoom | — | Mouse wheel |
| Gunner's sight | **AIM** button, then drag to lay the gun | Right mouse button or E |
| Fire main gun | **FIRE** (shows the reload ring) | Left mouse button |
| Coaxial MG | Hold **MG** | Hold Space |
| Ammunition | **AMMO** → AP / HE / SMOKE | 1 / 2 / 3 |
| Platoon orders | **ORDERS** (time slows while open) | Q |
| Formation | ORDERS → Column / Line / Wedge | F |
| Tactical map | **MAP** or tap the minimap | M |
| Recentre camera | ⟲ | — |
| Artillery fire mission | **ARTY**, then tap the map | R |
| Skip end-of-mission camera | **SKIP** | SKIP |
| Pause | II | Esc |

MAP and the minimap need a short, deliberate tap. A finger that lands on them and drags pans the camera instead, and taps are ignored while you are firing, so the map does not open by accident in a fight.

Multi-touch is fully supported. You can drive, look and fire at the same time. On command transfer every finger is released safely.

## The Battle of Bellwick

1. **Southern Approach:** drive, camera and formation training. Reach the crossroads.
2. **First Contact:** knock out a V-32 Boar at the farmhouse (aim mode, AP, armour angles). The platoon lets you take the first shot.
3. **Airborne Rendezvous:** meet Able Company of the 9th Airborne in the western orchards.
4. **Suppress the Defences:** an MG nest, riflemen and a second Boar (HE and MG training).
5. **Smoke Screen:** screen the open crossing from the Hollow Wood anti-tank gun so the paratroopers can cross. The mission checks that the smoke actually blocks the gun's view.
6. **Bellwick Town Square:** two V-41 Ox medium tanks. A single Boar reinforcement arrives only after the first Ox falls, with a radio warning.
7. **Victory:** the paratroopers enter the square and the Alderland colours are raised.

## The Kessler Ridge Gauntlet (mission 2)

A defensive armour battle, unlocked by completing Bellwick. The Varkovian 4th Armoured counter-attacks
across the wheat plain and you hold the ridge until the anti-tank guns arrive.

1. **Occupy the ridge:** place Vanguard 1, 2 and 3 in their fighting positions before dawn.
2. **The probe:** five V-32 Boars test the line.
3. **The main assault:** eight Ox and Boar tanks across the whole frontage; Hammer Battery comes on call.
4. **Withdraw:** the brigade falls back to the reverse slope as the V-58 Bastions arrive.
5. **The gun line:** hold for two minutes while the anti-tank battery unlimbers and opens fire.

What's new in this mission:

- **Two more platoons under your command.** Vanguard 2 and Vanguard 3 have their own named commanders, fight
  their own sector, report on the radio and take losses. Designating a target with ATTACK MY TARGET pulls them
  onto it.
- **Artillery.** Tap ARTY, then tap the tactical map. Twenty-two seconds from call to the first round, three
  fire missions a battle, and an 18-round concentration that will wreck anything caught in the open — including
  your own platoon, so lead the target rather than aiming at where they are now. A banner counts the rounds
  down and the beaten zone is marked on the map and in the world.
- **Hull-down fighting.** The crest is high enough to hide a hull and low enough to shoot over. Sitting just
  behind it means incoming rounds strike the ridge instead of your front plate.
- **The V-58 Bastion.** A heavy tank whose frontal armour simply stops the Sentinel's 75 mm — six frontal hits
  do nothing. Flank it, catch it as it crests the ridge, or drop a barrage on it.

## Last Stand at Ardenne Farm (mission 3)

A hold-at-all-costs defence, unlocked by completing Kessler Ridge. The Varkovians have broken through on the
flank and the regiment's only supply road runs through the crossroads at Ardenne Farm. Three roads lead in —
the open **North Road**, the **East Track** out of the woods and the hedged **West Lane** — and a relief column
is nine minutes away.

1. **Defence plan:** before the first shot, a planning panel (with the tactical map) asks where to put three
   assets, one road each, doubling up if you like. They stay where you put them.
   - **Vanguard 2** — three Sentinels that hold their road and answer ATTACK MY TARGET.
   - **Anti-tank guns** — two dug-in guns: accurate out to 240 m, knocked out by return fire or if a tank reaches them.
   - **Minefield** — six mines across one road. A strike breaks a track and badly damages the tank; a marker
     and warning stakes show where it lies. Your own tanks cross it safely.
2. **The probe:** light tanks and infantry down the North Road.
3. **Both flanks:** armour on the East Track and West Lane together.
4. **General assault:** all three roads at once; Hammer Battery gives you two fire missions.
5. **The armoured push:** V-58 Bastions lead down the North Road while the flanks are pinned. Hold until
   Sabre 1, the relief column, comes up the south road.

What's new in this mission:

- **Supply lorries.** Two lorries are parked in the farmyard. Halt within a few metres of one for five seconds
  and your tank — and any of your platoon close by — is rearmed and patched up to 85% hull. The crews need 45
  seconds between visits. Enemy tanks with a view into the yard shell the lorries; lose both and there is no
  more ammunition.
- **Losing the farm.** Enemy tanks sitting in the farmyard run down an overrun clock. Clear them out or the
  mission is lost even if your platoon survives.
- **A battle clock.** The objective shows the time until relief. Beating off a wave early brings the next one
  forward (after a lull long enough to rearm), so a good defence shortens the battle.

## Difficulty

Settings → Difficulty sets enemy crew quality, and it is the main dial if the game feels too easy or too hard:

| Level | Enemy damage | Time to spot you | Gun dispersion |
|---|---|---|---|
| Recruit | 70% | slow | loose |
| **Veteran** (default) | 105% | normal | accurate |
| Elite | 135% | fast | tight |

Each mission also carries its own multiplier on top: Bellwick is gentler than the rest, Kessler Ridge and Ardenne Farm harder.

**Hull-down matters, but it is not invisibility.** A tank behind a crest is still spotted and shot at — its
protection comes from incoming rounds striking the ridge and from presenting only turret armour.

## Campaign rules implemented

- **Ranks** (3SG → 1WO) are separate from **appointments** (Platoon Commander, Deputy, Tank Commander). Promotions are decided only after missions, using XP, missions completed, time since the last promotion, leadership experience and mission performance. One tutorial mission never promotes anyone.
- **Casualties:** a knocked-out tank does not automatically mean a dead commander. A probabilistic model weighs penetration, crew-compartment hits, fire, ammunition detonation and severity. Commanders can come out unhurt, wounded, incapacitated or killed. Death is possible but uncommon in Bellwick.
- **Command succession:** if your tank is destroyed or disabled, play slows, the transfer card appears, and control passes to the next operational tank (Mercer → Vale → Bennett → Ward). The battlefield state is preserved. The mission fails only if all four tanks are lost.
- **Save integrity:** the campaign is saved before deployment and never written during combat. Restarting or failing restores the pre-mission state. A successful result is locked in as *pending* immediately, so reloading the page cannot dodge a death. Results are committed when you confirm the debrief, and committing is idempotent: no duplicate XP or medals.
- **Between missions:** the dead go to the **Roll of Honour** with their full record. Vale (or the next senior survivor) takes command. Replacement commanders (new names, service numbers and biographies, never clones) and replacement Sentinels fill the gaps. Platoon **cohesion** drops with veteran losses and recovers over time.
- **Decorations** are awarded by tracked events, never at random: Star of Valour, Armoured Service Cross, Gunner's Laurel, Iron Shield Medal, and the Bellwick, Kessler Ridge, Ardenne Farm and Dawn Spear ribbons. Posthumous awards are supported.
- Save **export/import** is available in Settings.

## Architecture

```
src/
  core/         input (Pointer Events joystick + keyboard/mouse), settings, seeded RNG
  rendering/    procedural low-poly models, merged-geometry builder, GPU billboard particles, canvas textures
  world/        terrain height field, Bellwick builder, collision/LOS/smoke world
  vehicles/     tank physics, turret stabilisation, suspension, damage states
  weapons/      ballistics, armour/angle penetration, HE splash, MG hitscan, knock-outs, artillery
  ai/           friendly, allied-platoon and enemy tank AI (spotting, flanking, patrol, retreat)
  platoon/      orders, formations, delays (leadership + cohesion)
  infantry/     airborne & enemy squads, MG nests, pinning
  missions/     mission registry and interface; Bellwick, Kessler and Ardenne map data and phase scripts
  campaign/     campaign types, creation, appointments, replacements   (pure, no rendering)
  progression/  mission tracker (XP attribution), casualty model, debrief/commit   (pure)
  persistence/  versioned localStorage saves with migration
  ui/           HUD, menus, procedural portraits, rank insignia and medals
  audio/        fully synthesised WebAudio sound and an original orchestral score (no audio files)
  data/         ranks, tanks, commanders, medals
```

Gameplay state is kept separate from rendering. Campaign and progression code is plain TypeScript with no Three.js, which is why it's unit-tested in Node. To add a mission, add a map definition and a `MissionScript` under `missions/`, then register it in
`missions/registry.ts` with the missions it requires. The engine, campaign and debrief stay as they are.

### Performance (mobile)

Static scenery is merged into a few vertex-coloured draw calls, trees are instanced, particles are one instanced draw call per system, and shadows are blobs except on **High**. There are **Low / Medium / High** presets and a 30/60/uncapped frame-rate cap in Settings.

## Notes

- All nations, insignia, uniforms and vehicles are fictional. There are no real-world army markings.
- Every model, texture and sound is generated in code. There are no external assets, servers or paid APIs.
- `window.__ironVanguard` is a debug handle used by automated smoke tests.
