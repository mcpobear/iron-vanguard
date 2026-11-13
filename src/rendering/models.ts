import * as THREE from 'three';
import { GeoBuilder } from './geo';
import { tankDecal, trackTexture, blobShadow } from './textures';
import type { TankDef } from '../data/tanks';

export interface TankView {
  root: THREE.Group;
  body: THREE.Group; // receives pitch/roll (suspension)
  turret: THREE.Group;
  gunPivot: THREE.Group;
  barrel: THREE.Object3D; // recoils along -z
  muzzle: THREE.Object3D;
  sight: THREE.Object3D; // gunner's sight position
  coax: THREE.Object3D;
  tracks: { mesh: THREE.Mesh; tex: THREE.Texture }[];
  commander: THREE.Object3D;
  materials: THREE.MeshLambertMaterial[];
  shadow: THREE.Mesh;
  turretHeight: number;
}

interface Style {
  hull: number;
  hull2: number;
  dark: number;
  turretShape: 'box' | 'hex' | 'round';
  turretSize: [number, number, number];
  turretZ: number;
  gunLen: number;
  gunR: number;
  wheels: number;
  slopedFront: boolean;
  camo: number | null;
}

const STYLES: Record<string, Style> = {
  'A-44': { hull: 0x5d7a3a, hull2: 0x6d8a46, dark: 0x3c4e28, turretShape: 'round', turretSize: [2.35, 0.95, 2.7], turretZ: -0.3, gunLen: 4.3, gunR: 0.11, wheels: 5, slopedFront: true, camo: null },
  'V-32': { hull: 0x737268, hull2: 0x83827a, dark: 0x4a4944, turretShape: 'box', turretSize: [1.6, 0.8, 1.8], turretZ: 0.1, gunLen: 2.1, gunR: 0.07, wheels: 4, slopedFront: false, camo: 0x7a5a3a },
  'V-41': { hull: 0x7a6a52, hull2: 0x8a7a60, dark: 0x4f4433, turretShape: 'hex', turretSize: [2.5, 1.05, 2.6], turretZ: -0.2, gunLen: 3.4, gunR: 0.1, wheels: 5, slopedFront: false, camo: 0x5e6b4a },
};

const trackGeo = new THREE.BoxGeometry(1, 1, 1);

export function buildTankModel(def: TankDef, number: string, castShadow: boolean): TankView {
  const st = STYLES[def.id];
  const { length: L, width: W, height: H } = def.hull;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const materials: THREE.MeshLambertMaterial[] = [];
  const vmat = () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    materials.push(m);
    return m;
  };

  // --- hull (merged) ---
  const gb = new GeoBuilder();
  const trackW = W * 0.24;
  const tx = W / 2 - trackW / 2;
  const hullBottom = 0.45;
  const deck = H;
  gb.box(0, (hullBottom + deck) / 2, -0.1, W - trackW * 2 + 0.1, deck - hullBottom, L * 0.88, st.dark);
  // upper hull with fenders
  gb.box(0, deck - 0.22, -0.25, W + 0.1, 0.44, L * 0.78, st.hull, 0, 0.04);
  if (st.slopedFront) {
    gb.box(0, deck - 0.45, L * 0.36, W - 0.2, 0.25, L * 0.32, st.hull2, 0, 0, -0.55);
    gb.box(0, 0.8, L * 0.46, W - trackW * 2, 0.7, 0.4, st.dark, 0, 0, 0.6);
  } else {
    gb.box(0, deck - 0.4, L * 0.38, W - 0.1, 0.8, L * 0.22, st.hull2, 0, 0, -0.25);
  }
  // rear deck, engine grille, exhausts
  gb.box(0, deck + 0.02, -L * 0.33, W * 0.7, 0.08, L * 0.22, st.dark);
  for (const sx of [-1, 1]) gb.cylinder(sx * W * 0.3, deck - 0.3, -L * 0.47, 0.12, 0.5, 0x3a3a3a, 6, Math.PI / 2);
  // headlights & tools
  for (const sx of [-1, 1]) gb.cylinder(sx * W * 0.32, deck + 0.05, L * 0.42, 0.14, 0.18, 0xe8e2c0, 6, Math.PI / 2);
  gb.box(W * 0.42, deck + 0.05, -0.4, 0.15, 0.12, 2.2, 0x6b4f35);
  // road wheels and sprockets
  const wr = 0.42;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < st.wheels; i++) {
      const z = -L * 0.36 + (i * (L * 0.72)) / (st.wheels - 1);
      gb.cylinder(sx * (W / 2 + 0.02), wr + 0.05, z, wr, 0.14, 0x2e2e2c, 8, 0, 0, Math.PI / 2);
      gb.cylinder(sx * (W / 2 + 0.08), wr + 0.05, z, wr * 0.45, 0.05, st.hull2, 6, 0, 0, Math.PI / 2);
    }
    gb.cylinder(sx * (W / 2 + 0.02), 0.85, L * 0.46, 0.36, 0.16, 0x2e2e2c, 8, 0, 0, Math.PI / 2);
    gb.cylinder(sx * (W / 2 + 0.02), 0.8, -L * 0.46, 0.34, 0.16, 0x2e2e2c, 8, 0, 0, Math.PI / 2);
  }
  // camo blotches for Varkovian vehicles
  if (st.camo !== null) {
    for (let i = 0; i < 6; i++) {
      const z = -L * 0.35 + i * L * 0.14;
      gb.box(i % 2 ? W * 0.51 : -W * 0.51, deck - 0.22, z, 0.04, 0.32, 0.9, st.camo);
    }
  }
  const hullMesh = new THREE.Mesh(gb.build(), vmat());
  hullMesh.castShadow = castShadow;
  body.add(hullMesh);

  // --- tracks (scrolling texture) ---
  const tracks: { mesh: THREE.Mesh; tex: THREE.Texture }[] = [];
  for (const sx of [-1, 1]) {
    const tex = trackTexture();
    tex.repeat.set(1, L / 1.1);
    const m = new THREE.Mesh(trackGeo, new THREE.MeshLambertMaterial({ map: tex }));
    materials.push(m.material as THREE.MeshLambertMaterial);
    m.scale.set(trackW, 1.05, L * 0.97);
    m.position.set(sx * tx, 0.56, 0);
    m.castShadow = castShadow;
    body.add(m);
    tracks.push({ mesh: m, tex });
  }

  // --- turret ---
  const turret = new THREE.Group();
  turret.position.set(0, deck, st.turretZ);
  body.add(turret);
  const tg = new GeoBuilder();
  const [tw, th, tl] = st.turretSize;
  if (st.turretShape === 'round') {
    tg.cylinder(0, th / 2, 0, tw / 2, th, st.hull, 10);
    tg.box(0, th / 2, -tl * 0.35, tw * 0.8, th * 0.85, tl * 0.5, st.hull2);
    tg.cylinder(0, th + 0.02, 0, tw / 2 - 0.08, 0.08, st.hull2, 10);
  } else if (st.turretShape === 'hex') {
    tg.cylinder(0, th / 2, 0, tw / 2, th, st.hull, 6, 0, Math.PI / 6);
    tg.box(0, th / 2, -tl * 0.4, tw * 0.6, th * 0.8, tl * 0.4, st.hull2);
  } else {
    tg.box(0, th / 2, 0, tw, th, tl, st.hull, 0, 0.03);
    tg.box(0, th / 2, tl * 0.5, tw * 0.9, th * 0.9, 0.2, st.hull2);
  }
  // cupola
  const cupX = -tw * 0.22, cupZ = -tl * 0.12;
  tg.cylinder(cupX, th + 0.18, cupZ, 0.38, 0.36, st.hull2, 8);
  tg.box(cupX, th + 0.55, cupZ - 0.42, 0.7, 0.06, 0.5, st.dark, 0, 0, -1.1);
  // antenna and stowage
  tg.cylinder(tw * 0.32, th + 1.4, -tl * 0.4, 0.02, 2.8, 0x2a2a2a, 4);
  tg.box(0, th * 0.5, -tl * 0.62, tw * 0.7, th * 0.5, 0.4, 0x6b5a3a);
  const turretMesh = new THREE.Mesh(tg.build(), vmat());
  turretMesh.castShadow = castShadow;
  turret.add(turretMesh);

  // commander figure in the cupola
  const cmd = new GeoBuilder();
  cmd.box(0, 0.25, 0, 0.5, 0.5, 0.38, def.nation === 'alderland' ? 0x6b6a3a : 0x5a6270);
  cmd.box(0, 0.68, 0, 0.36, 0.36, 0.36, 0xe2b48f);
  if (def.nation === 'alderland') cmd.box(0.05, 0.9, 0, 0.42, 0.12, 0.42, 0x7a1f2b);
  else cmd.box(0, 0.9, 0, 0.44, 0.16, 0.44, 0x3a4250);
  const commander = new THREE.Mesh(cmd.build(), vmat());
  commander.position.set(cupX, th + 0.15, cupZ);
  turret.add(commander);

  // decals
  const decalTex = tankDecal(def.nation, number);
  const decalMat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.64), decalMat);
    p.position.set(sx * (tw / 2 + 0.02), th * 0.5, -tl * 0.05);
    p.rotation.y = sx * Math.PI / 2;
    turret.add(p);
  }

  // gun
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, th * 0.5, tl * 0.48);
  turret.add(gunPivot);
  const mg = new GeoBuilder();
  mg.box(0, 0, 0.15, tw * 0.42, th * 0.7, 0.45, st.hull2);
  const mantlet = new THREE.Mesh(mg.build(), vmat());
  gunPivot.add(mantlet);
  const barrel = new THREE.Group();
  gunPivot.add(barrel);
  const bg = new GeoBuilder();
  bg.cylinder(0, 0, st.gunLen / 2 + 0.2, st.gunR, st.gunLen, st.dark, 8, Math.PI / 2);
  bg.cylinder(0, 0, 0.7, st.gunR * 1.5, 1.0, st.dark, 8, Math.PI / 2);
  if (def.id === 'A-44') bg.box(0, 0, st.gunLen + 0.25, st.gunR * 3.2, st.gunR * 2.2, 0.4, 0x2e2e2c);
  const barrelMesh = new THREE.Mesh(bg.build(), vmat());
  barrelMesh.castShadow = castShadow;
  barrel.add(barrelMesh);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, st.gunLen + 0.5);
  barrel.add(muzzle);
  const coax = new THREE.Object3D();
  coax.position.set(tw * 0.15, 0.05, 0.6);
  gunPivot.add(coax);
  const sight = new THREE.Object3D();
  sight.position.set(-tw * 0.2, 0.25, 0.3);
  gunPivot.add(sight);

  // blob shadow (cheap; real shadows only on High)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.7, L * 1.3), new THREE.MeshBasicMaterial({ map: blobShadow(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.06;
  shadow.renderOrder = -1;
  root.add(shadow);

  return { root, body, turret, gunPivot, barrel, muzzle, sight, coax, tracks, commander, materials, shadow, turretHeight: deck + th };
}

export function soldierGeometry(side: 'ally' | 'enemy'): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const uni = side === 'ally' ? 0x8a7d4a : 0x5d6878;
  const dark = side === 'ally' ? 0x6b5f36 : 0x434c5a;
  const skin = 0xe2b48f;
  g.box(-0.13, 0.42, 0, 0.22, 0.84, 0.26, dark);
  g.box(0.13, 0.42, 0, 0.22, 0.84, 0.26, dark);
  g.box(0, 1.15, 0, 0.56, 0.66, 0.32, uni, 0, 0.05);
  g.box(-0.36, 1.12, 0.08, 0.16, 0.6, 0.18, uni, 0, 0, -0.5);
  g.box(0.36, 1.12, 0.12, 0.16, 0.6, 0.18, uni, 0, 0, -0.9);
  g.box(0, 1.66, 0, 0.36, 0.36, 0.34, skin);
  if (side === 'ally') {
    g.sphere(0, 1.84, 0, 0.26, 0x55603a, 0, 0.6);
    g.box(0, 1.25, -0.22, 0.4, 0.42, 0.14, 0x6b5a3a); // pack
  } else {
    g.box(0, 1.88, 0, 0.42, 0.18, 0.42, 0x3a4250);
    g.box(0, 1.8, 0.02, 0.5, 0.06, 0.5, 0x3a4250);
  }
  g.box(0.22, 1.18, 0.42, 0.07, 0.07, 1.0, 0x4a3a2a, 0, 0, 0); // rifle
  return g.build();
}

export function mgNestGeometry(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    if (a > Math.PI * 0.8 && a < Math.PI * 1.2) continue; // rear opening
    for (let row = 0; row < 2; row++)
      g.box(Math.sin(a) * 2.4, 0.3 + row * 0.5, Math.cos(a) * 2.4, 1.15, 0.5, 0.75, row ? 0xb8a37a : 0xa8936a, a, 0.12);
  }
  g.box(0, 1.0, 0.8, 0.12, 0.12, 1.4, 0x2a2a2a);
  g.box(0, 0.8, 0.3, 0.3, 0.3, 0.5, 0x3a3a3a);
  for (const a of [-0.5, 0.5, Math.PI]) g.box(Math.sin(a) * 0.3, 0.45, 0.3 + Math.cos(a) * 0.3, 0.05, 0.8, 0.05, 0x2a2a2a, 0, 0, 0.3);
  return g.build();
}

export function strongpointGeometry(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  for (let i = 0; i < 18; i++) {
    const a = -1.2 + (i / 17) * 2.4;
    g.box(Math.sin(a - Math.PI / 2) * 4, 0.45, Math.cos(a - Math.PI / 2) * 4, 1.3, 0.9, 0.9, 0xa8936a, a, 0.12);
  }
  // anti-tank gun
  g.box(0, 0.9, 0, 1.6, 1.2, 0.12, 0x5d6878, Math.PI / 2);
  g.cylinder(-1.6, 1.0, 0, 0.08, 3.2, 0x3a3a3a, 6, 0, 0, Math.PI / 2);
  g.cylinder(0.3, 0.45, 0.7, 0.45, 0.15, 0x2a2a2a, 8, Math.PI / 2);
  g.cylinder(0.3, 0.45, -0.7, 0.45, 0.15, 0x2a2a2a, 8, Math.PI / 2);
  return g.build();
}
