import type { Settings } from './settings';

/**
 * Unified input: floating virtual joystick + touch camera drag (Pointer Events, multi-touch),
 * with optional keyboard & mouse on desktop. Gameplay code only reads the abstract state.
 */
export class Input {
  /** Smoothed analogue drive input. x = steer (-1..1), y = throttle (-1..1). */
  move = { x: 0, y: 0 };
  private rawMove = { x: 0, y: 0 };
  lookDX = 0;
  lookDY = 0;
  zoomDelta = 0;
  mgHeld = false;
  /** Edge-triggered actions, consumed by the game each frame. */
  private actions = new Set<string>();

  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyPos = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private ignored = new Set<number>();
  private keys = new Set<string>();
  private kbMove = { x: 0, y: 0 };
  enabled = true;
  pointerLocked = false;

  private base: HTMLDivElement;
  private knob: HTMLDivElement;

  constructor(private layer: HTMLElement, private canvas: HTMLCanvasElement, private settings: () => Settings) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    layer.appendChild(this.base);

    layer.addEventListener('pointerdown', this.onDown, { passive: false });
    // Moves/ups are handled at window level: captured events bubble here, and if capture is
    // lost the finger is still tracked by its pointerId wherever it goes on screen.
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('blur', this.onBlur);

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    layer.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomDelta += Math.sign(e.deltaY);
    }, { passive: false });
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    this.placeIdleJoystick();
    window.addEventListener('resize', this.onResize);
  }

  private onBlur = () => this.resetAll();
  private onResize = () => this.placeIdleJoystick();
  private onLockChange = () => {
    const was = this.pointerLocked;
    this.pointerLocked = document.pointerLockElement === this.layer;
    if (was && !this.pointerLocked) this.actions.add('pointerUnlocked');
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || !this.enabled) return;
    this.lookDX += e.movementX * 0.6;
    this.lookDY += e.movementY * 0.6;
  };

  dispose() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.base.remove();
  }

  get touchMode() {
    return document.body.classList.contains('touch');
  }

  private joyRadius() {
    return 62 * this.settings().uiScale;
  }

  private placeIdleJoystick() {
    if (this.joyId !== null) return;
    const r = this.joyRadius();
    const x = Math.max(r + 40, window.innerWidth * 0.14);
    const y = window.innerHeight - r - 46;
    this.joyOrigin = { x, y };
    this.drawJoy(x, y, x, y, false);
  }

  private drawJoy(ox: number, oy: number, px: number, py: number, active: boolean) {
    const r = this.joyRadius();
    this.base.style.width = this.base.style.height = `${r * 2}px`;
    this.base.style.transform = `translate(${ox - r}px, ${oy - r}px)`;
    this.base.classList.toggle('active', active);
    const k = r * 0.46;
    this.knob.style.width = this.knob.style.height = `${k * 2}px`;
    this.knob.style.transform = `translate(${px - ox + r - k}px, ${py - oy + r - k}px)`;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    if (!this.touchMode && e.pointerType === 'mouse') {
      // Desktop: click locks the pointer for mouse-look; LMB fires, RMB toggles aim.
      if (!this.pointerLocked) {
        this.layer.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.actions.add('fire');
      if (e.button === 2) this.actions.add('aim');
      return;
    }
    const leftZone = e.clientX < window.innerWidth * 0.42 && e.clientY > window.innerHeight * 0.22;
    if (leftZone && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyPos = { x: e.clientX, y: e.clientY };
      this.capture(e.pointerId);
      this.drawJoy(e.clientX, e.clientY, e.clientX, e.clientY, true);
      this.updateRawFromJoy();
    } else if (this.lookId === null && e.pointerId !== this.joyId) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.capture(e.pointerId);
    }
  };

  private capture(id: number) {
    try {
      this.layer.setPointerCapture(id);
    } catch {
      /* not supported: window listeners still track the finger */
    }
  }

  private onMove = (e: PointerEvent) => {
    if (this.ignored.has(e.pointerId)) return;
    if (e.pointerId === this.joyId) {
      e.preventDefault();
      // Finger may be far outside the joystick graphic — keep tracking it.
      this.joyPos = { x: e.clientX, y: e.clientY };
      this.updateRawFromJoy();
      const r = this.joyRadius();
      const dx = this.joyPos.x - this.joyOrigin.x;
      const dy = this.joyPos.y - this.joyOrigin.y;
      const d = Math.hypot(dx, dy);
      const s = d > r ? r / d : 1;
      this.drawJoy(this.joyOrigin.x, this.joyOrigin.y, this.joyOrigin.x + dx * s, this.joyOrigin.y + dy * s, true);
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      this.lookDX += e.clientX - this.lookLast.x;
      this.lookDY += e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.ignored.delete(e.pointerId)) return;
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.rawMove = { x: 0, y: 0 };
      this.placeIdleJoystick();
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  };

  private updateRawFromJoy() {
    const r = this.joyRadius();
    let dx = (this.joyPos.x - this.joyOrigin.x) / r;
    let dy = -(this.joyPos.y - this.joyOrigin.y) / r;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    const mag = Math.min(1, m);
    const dead = 0.12;
    if (mag < dead) {
      this.rawMove = { x: 0, y: 0 };
      return;
    }
    const sens = this.settings().joystickSensitivity;
    const scaled = Math.min(1, ((mag - dead) / (1 - dead)) * sens);
    const nx = dx / (mag || 1);
    const ny = dy / (mag || 1);
    this.rawMove = { x: nx * scaled, y: ny * scaled };
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const k = e.key.toLowerCase();
    if (e.repeat) return;
    this.keys.add(k);
    switch (k) {
      case ' ':
        this.mgHeld = true;
        e.preventDefault();
        break;
      case '1':
        this.actions.add('ammo:AP');
        break;
      case '2':
        this.actions.add('ammo:HE');
        break;
      case '3':
        this.actions.add('ammo:SMOKE');
        break;
      case 'q':
        this.actions.add('orders');
        break;
      case 'f':
        this.actions.add('formation');
        break;
      case 'm':
        this.actions.add('map');
        break;
      case 'escape':
        this.actions.add('pause');
        break;
      case 'e':
        this.actions.add('aim');
        break;
      case 'enter':
        this.actions.add('fire');
        break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (k === ' ') this.mgHeld = false;
  };

  press(action: string) {
    if (this.enabled) this.actions.add(action);
  }

  consume(action: string): boolean {
    return this.actions.delete(action);
  }

  consumePrefix(prefix: string): string | null {
    for (const a of this.actions) {
      if (a.startsWith(prefix)) {
        this.actions.delete(a);
        return a.slice(prefix.length);
      }
    }
    return null;
  }

  update(dt: number) {
    // Keyboard ramps like an analogue stick so it feels the same as touch.
    const tx = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    const ty = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const kr = Math.min(1, dt * 5);
    this.kbMove.x += (tx - this.kbMove.x) * kr;
    this.kbMove.y += (ty - this.kbMove.y) * kr;
    const useKb = Math.abs(tx) + Math.abs(ty) > 0 || (this.joyId === null && (Math.abs(this.kbMove.x) > 0.02 || Math.abs(this.kbMove.y) > 0.02));
    const target = useKb && this.joyId === null ? this.kbMove : this.rawMove;
    const r = Math.min(1, dt * 12);
    this.move.x += (target.x - this.move.x) * r;
    this.move.y += (target.y - this.move.y) * r;
    if (!this.enabled) this.move = { x: 0, y: 0 };
  }

  takeLook() {
    const d = { x: this.lookDX, y: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return d;
  }
  takeZoom() {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }

  /** Release every finger and zero all input (used on command transfer and pauses). */
  resetAll() {
    for (const id of [this.joyId, this.lookId]) {
      if (id === null) continue;
      this.ignored.add(id);
      try {
        this.layer.releasePointerCapture(id);
      } catch {
        /* ignore */
      }
    }
    this.joyId = null;
    this.lookId = null;
    this.rawMove = { x: 0, y: 0 };
    this.move = { x: 0, y: 0 };
    this.kbMove = { x: 0, y: 0 };
    this.keys.clear();
    this.mgHeld = false;
    this.lookDX = this.lookDY = 0;
    this.actions.clear();
    this.placeIdleJoystick();
    document.dispatchEvent(new CustomEvent('iv-release-buttons'));
  }

  exitPointerLock() {
    if (this.pointerLocked) document.exitPointerLock?.();
  }

  setVisible(v: boolean) {
    this.base.style.display = v ? '' : 'none';
  }
}
