import * as THREE from 'three';

/**
 * Accumulates many low-poly parts into a single vertex-coloured BufferGeometry so that whole
 * buildings, tanks or the town render in a handful of draw calls (important on phones).
 */
export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private v = new THREE.Vector3();
  private c = new THREE.Color();

  addGeometry(g: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation, jitter = 0) {
    const geo = g.index ? g.toNonIndexed() : g;
    const p = geo.getAttribute('position');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const n = geo.getAttribute('normal');
    this.nm.getNormalMatrix(matrix);
    this.c.set(color);
    if (jitter) {
      const j = 1 + (Math.random() - 0.5) * jitter;
      this.c.multiplyScalar(j);
    }
    const ec = geo.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize();
      this.nor.push(this.v.x, this.v.y, this.v.z);
      if (ec) this.col.push(ec.getX(i) * this.c.r, ec.getY(i) * this.c.g, ec.getZ(i) * this.c.b);
      else this.col.push(this.c.r, this.c.g, this.c.b);
    }
    if (geo !== g) geo.dispose();
  }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, rotY = 0, jitter = 0, rotX = 0, rotZ = 0) {
    const g = BOX;
    this.m.makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ'));
    this.m.scale(new THREE.Vector3(sx, sy, sz));
    this.m.setPosition(x, y, z);
    this.addGeometry(g, this.m, color, jitter);
  }

  /** Triangular prism (pitched roof) spanning sx × sz with ridge along local z, peak height h. */
  roof(x: number, y: number, z: number, sx: number, h: number, sz: number, color: THREE.ColorRepresentation, rotY = 0, jitter = 0) {
    this.m.makeRotationY(rotY);
    this.m.scale(new THREE.Vector3(sx, h, sz));
    this.m.setPosition(x, y, z);
    this.addGeometry(PRISM, this.m, color, jitter);
  }

  cylinder(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, segs = 8, rotX = 0, rotY = 0, rotZ = 0) {
    const g = cyl(segs);
    this.m.makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ'));
    this.m.scale(new THREE.Vector3(r, h, r));
    this.m.setPosition(x, y, z);
    this.addGeometry(g, this.m, color);
  }

  cone(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, segs = 6) {
    this.m.makeScale(r, h, r);
    this.m.setPosition(x, y, z);
    this.addGeometry(cone(segs), this.m, color);
  }

  sphere(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, detail = 0, sy = 1, jitter = 0) {
    this.m.makeScale(r, r * sy, r);
    this.m.setPosition(x, y, z);
    this.addGeometry(ico(detail), this.m, color, jitter);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PRISM = (() => {
  // unit prism: base -0.5..0.5 in x and z at y=0, ridge at y=1 along z
  const g = new THREE.BufferGeometry();
  const v = [
    // front gable
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5,
    // back gable
    0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5,
    // left slope
    -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    // right slope
    0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
})();
const cylCache = new Map<number, THREE.BufferGeometry>();
const cyl = (s: number) => {
  let g = cylCache.get(s);
  if (!g) cylCache.set(s, (g = new THREE.CylinderGeometry(1, 1, 1, s).toNonIndexed()));
  g.computeVertexNormals();
  return g;
};
const coneCache = new Map<number, THREE.BufferGeometry>();
const cone = (s: number) => {
  let g = coneCache.get(s);
  if (!g) coneCache.set(s, (g = new THREE.ConeGeometry(1, 1, s).toNonIndexed()));
  return g;
};
const icoCache = new Map<number, THREE.BufferGeometry>();
const ico = (d: number) => {
  let g = icoCache.get(d);
  if (!g) {
    g = new THREE.IcosahedronGeometry(1, d);
    g = g.index ? g.toNonIndexed() : g;
    g.computeVertexNormals();
    icoCache.set(d, g);
  }
  return g;
};

export const VC_MATERIAL = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
