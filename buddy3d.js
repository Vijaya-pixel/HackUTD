/* SafeT Buddy, the 3D mascot, built with plain three.js so it runs in this no-build app. Round peach body, two-tone cap with a projecting brim and the
   T logo on the front panel, round headphones, antenna, hands, magenta shoes, glossy eyes, open mouths, brows,
   per-expression effects (sweat drop, action lines, "!!", sparkle, Zzz, confetti) and per-expression motion with
   damping and a squash-stretch pop on every expression change.

   One renderer stays alive; its canvas is moved into whatever `.pet3d` container the current render produced.
   window.Buddy3D.attach(el, { health, reaction })   mount/move the canvas into el and update the expression
   window.Buddy3D.setState({ health, reaction })     update without re-mounting
   window.Buddy3D.face(dx)                           turn toward the walking direction (-1, 0, 1) */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const P = { skin: '#F8CBA6', magenta: '#E20074', magentaDeep: '#C4005F', white: '#FFF8F4', cushion: '#3B1820', eye: '#1E1215', mouth: '#7A0E2E', tongue: '#FF6F8E', blush: '#FF9DB6', blue: '#59C3F0', yellow: '#FFC93C', purple: '#6B3FA0' };
const LOGO_URL = 'assets/logo-t.png', FONT_URL = 'assets/fonts/Poppins-Bold.ttf';
const BODY = { a: 0.8, b: 0.74, c: 0.72, y: -0.02 };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sphereGeo = new THREE.SphereGeometry(1, 48, 32);
const std = (color, roughness = 0.55) => new THREE.MeshStandardMaterial({ color, roughness });
const gloss = color => new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.25 });
const basic = color => new THREE.MeshBasicMaterial({ color });

export function emotionFromHealth(value) {
  const h = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return h <= 25 ? 'critical' : h <= 50 ? 'worried' : h <= 75 ? 'happy' : 'excited';
}
function orb(position, scale, color, isGloss) {
  const m = new THREE.Mesh(sphereGeo, isGloss ? gloss(color) : std(color));
  m.position.set(...position); typeof scale === 'number' ? m.scale.setScalar(scale) : m.scale.set(...scale);
  return m;
}
function stroke(pts, r = 0.016, color = P.eye) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => V(x, y, 0)));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 10, false), basic(color)));
  for (const [x, y] of [pts[0], pts[pts.length - 1]]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), basic(color)); cap.position.set(x, y, 0); g.add(cap); }
  return g;
}
/** Places a part flush on the ellipsoid body, oriented along the surface normal. */
function onBody(x, y, child, off = 0.006) {
  const z = BODY.c * Math.sqrt(Math.max(0, 1 - (x / BODY.a) ** 2 - (y / BODY.b) ** 2));
  const n = V(x / BODY.a ** 2, y / BODY.b ** 2, z / BODY.c ** 2).normalize();
  const g = new THREE.Group();
  g.position.copy(V(x, y + BODY.y, z).addScaledVector(n, off));
  g.quaternion.setFromUnitVectors(V(0, 0, 1), n);
  g.add(child);
  return g;
}
function shapeD(w, d) { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); for (let i = 0; i <= 32; i++) { const t = (i / 32) * Math.PI; s.lineTo(-Math.cos(t) * w / 2, -Math.sin(t) * d); } s.quadraticCurveTo(0, d * 0.12, -w / 2, 0); return s; }
function shapeOval(w, h) { const s = new THREE.Shape(); s.absellipse(0, 0, w, h, 0, Math.PI * 2, false, 0); return s; }
function openMouth(kind) {
  let outer, tongue;
  if (kind === 'o') { outer = shapeOval(0.06, 0.08); tongue = shapeOval(0.04, 0.03); }
  else if (kind === 'tiny') { outer = shapeOval(0.032, 0.038); tongue = null; }
  else { const w = kind === 'big' ? 0.25 : 0.19, d = kind === 'big' ? 0.17 : 0.12; outer = shapeD(w, d); tongue = shapeOval(w * 0.24, d * 0.28); }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(outer, 32), basic(P.mouth)));
  if (tongue) { const t = new THREE.Mesh(new THREE.ShapeGeometry(tongue, 24), basic(P.tongue)); t.position.set(0, kind === 'o' ? -0.035 : kind === 'big' ? -0.12 : -0.085, 0.002); g.add(t); }
  return g;
}
function eye(emotion, blink, side) {
  switch (emotion) {
    case 'critical': { const g = new THREE.Group(); g.add(stroke([[-0.07, 0.07], [0.07, -0.07]], 0.022)); g.add(stroke([[-0.07, -0.07], [0.07, 0.07]], 0.022)); return g; }
    case 'excited': return stroke([[-0.075, -0.025], [0, 0.045], [0.075, -0.025]], 0.02);
    case 'sleepy': return stroke([[-0.075, 0.015], [0, -0.035], [0.075, 0.015]], 0.016);
    case 'celebrating': return stroke(side < 0 ? [[-0.07, 0.065], [0.06, 0], [-0.07, -0.065]] : [[0.07, 0.065], [-0.06, 0], [0.07, -0.065]], 0.02);
  }
  if (blink) return stroke([[-0.065, 0], [0.065, 0]], 0.016);
  const big = emotion === 'surprised' ? 1.12 : 1, squint = emotion === 'determined' ? 0.82 : 1;
  const g = new THREE.Group(); g.scale.set(big, big * squint, 1);
  g.add(orb([0, 0, 0], [0.085, 0.125, 0.035], P.eye, true)); g.add(orb([-0.028, 0.048, 0.03], 0.027, '#ffffff'));
  return g;
}
function brow(emotion, side) {
  if (emotion === 'worried') return stroke([[side * 0.08, -0.015], [0, 0.012], [-side * 0.08, 0.04]], 0.015);
  if (emotion === 'determined') return stroke([[side * 0.085, 0.045], [-side * 0.08, -0.02]], 0.019);
  return null;
}
function mouth(emotion) {
  switch (emotion) {
    case 'critical': case 'worried': return stroke([[-0.1, -0.03], [0, 0.03], [0.1, -0.03]], 0.017);
    case 'determined': return stroke([[-0.09, 0.02], [0, -0.035], [0.1, 0.03]], 0.017);
    case 'happy': return openMouth('small');
    case 'surprised': return openMouth('o');
    case 'sleepy': return openMouth('tiny');
    default: return openMouth('big');
  }
}
function buildFace(emotion, blink) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(onBody(s * 0.22, 0.03, eye(emotion, blink, s)));
  for (const s of [-1, 1]) { const b = brow(emotion, s); if (b) g.add(onBody(s * 0.23, 0.2, b)); }
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: P.blush, transparent: true, opacity: 0.85 })); c.scale.set(0.085, 0.05, 1); g.add(onBody(s * 0.43, -0.11, c, 0.004)); }
  const m = new THREE.Group(); m.scale.setScalar(1.3); m.add(mouth(emotion)); g.add(onBody(0, -0.18, m));
  return g;
}

/* ---------- cap, headphones ---------- */
function buildCap(logoTex) {
  const g = new THREE.Group(); g.position.set(0, 0.38, -0.02); g.rotation.set(-0.02, 0.3, 0.1); g.scale.setScalar(1.04);
  const panel = 0.95;
  const front = new THREE.Mesh(new THREE.SphereGeometry(0.7, 72, 40, Math.PI / 2 - panel, panel * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: P.white, roughness: 0.6, sheen: 0.4, side: THREE.DoubleSide }));
  front.scale.set(1, 0.8, 1); g.add(front);
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.7, 72, 40, Math.PI / 2 + panel, Math.PI * 2 - panel * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: P.magenta, roughness: 0.45, clearcoat: 0.3, side: THREE.DoubleSide }));
  back.scale.set(1, 0.8, 1); g.add(back);
  // The logo: a thin curved patch hugging the white front panel (the component projects a Decal there).
  if (logoTex) {
    const patch = new THREE.Mesh(new THREE.SphereGeometry(0.712, 48, 32, Math.PI / 2 - 0.3, 0.6, 0.28, 0.62), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    patch.scale.set(1, 0.8, 1); g.add(patch);
  }
  g.add(orb([0, 0.56, 0], [0.07, 0.035, 0.07], P.magenta, true));
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.028, 12, 96), std(P.magentaDeep)); band.position.set(0, 0.02, 0); band.rotation.x = Math.PI / 2; g.add(band);
  const s = new THREE.Shape(); s.moveTo(0.6, 0); for (let i = 0; i <= 40; i++) { const t = (i / 40) * Math.PI; s.lineTo(Math.cos(t) * 0.6, -Math.sin(t) * 0.44); } s.quadraticCurveTo(0, 0.14, 0.6, 0);
  const brimGeo = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.022, bevelSegments: 5, curveSegments: 40 });
  const brimG = new THREE.Group(); brimG.position.set(0, 0.03, 0.36); brimG.rotation.x = 0.26;
  const brim = new THREE.Mesh(brimGeo, new THREE.MeshPhysicalMaterial({ color: P.magenta, roughness: 0.4, clearcoat: 0.4 })); brim.rotation.x = -Math.PI / 2; brimG.add(brim); g.add(brimG);
  return g;
}
function buildHeadphones() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const cup = new THREE.Group(); cup.position.set(s * 0.79, 0.02, -0.02); cup.rotation.y = s * Math.PI / 2;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.12, 48), new THREE.MeshPhysicalMaterial({ color: P.magenta, roughness: 0.4, clearcoat: 0.4 })); disc.rotation.x = Math.PI / 2; disc.position.z = 0.03; cup.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.075, 20, 64), new THREE.MeshPhysicalMaterial({ color: P.magenta, roughness: 0.38, clearcoat: 0.5 })); ring.position.z = 0.1; cup.add(ring);
    cup.add(orb([0, 0, 0.12], [0.2, 0.2, 0.06], P.cushion));
    g.add(cup);
  }
  return g;
}

/* ---------- effects ---------- */
function roundedBox(w, h, d, r, color) { return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), std(color)); }
function makeEffect(kind, font) {
  const g = new THREE.Group(); g.userData.kind = kind;
  if (kind === 'critical') { // sweat drop
    g.position.set(0.56, 0.28, 0.58);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.11, 24), new THREE.MeshPhysicalMaterial({ color: P.blue, roughness: 0.15, clearcoat: 1 })); cone.position.y = 0.06; cone.rotation.z = Math.PI; g.add(cone);
    g.add(orb([0, 0, 0], 0.055, P.blue, true));
    g.userData.tick = t => { const k = (t * 0.6) % 1; g.position.y = 0.28 - k * 0.28; g.scale.setScalar(k < 0.85 ? 1 : (1 - k) / 0.15); };
  }
  if (kind === 'excited') { // action lines
    g.position.set(0.82, 0.7, 0.25);
    for (let i = 0; i < 3; i++) { const a = 0.5 + i * 0.45, w = new THREE.Group(); w.rotation.z = -a; const b = roundedBox(0.055, 0.2, 0.04, 0.02, P.magenta); b.position.y = 0.2; w.add(b); g.add(w); }
    g.userData.tick = t => g.scale.setScalar(0.85 + Math.abs(Math.sin(t * 6)) * 0.25);
  }
  if (kind === 'surprised') { // "!!"
    g.position.set(0.8, 0.7, 0.25);
    for (let i = 0; i < 2; i++) { const w = new THREE.Group(); w.position.set(i * 0.17, -i * 0.04, 0); w.rotation.z = -i * 0.2; const b = roundedBox(0.07, 0.24, 0.05, 0.03, P.magenta); b.position.y = 0.06; w.add(b); w.add(orb([0, -0.13, 0], 0.04, P.magenta)); g.add(w); }
    g.userData.tick = t => { g.rotation.z = -0.3 + Math.sin(t * 14) * 0.08; };
  }
  if (kind === 'determined') { // sparkle
    g.position.set(0.86, 0.3, 0.35);
    const s = new THREE.Shape(); for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 2, r = i % 2 === 0 ? 0.17 : 0.045; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 3 }), new THREE.MeshPhysicalMaterial({ color: P.yellow, emissive: P.yellow, emissiveIntensity: 0.25, roughness: 0.3 })));
    g.userData.tick = t => { g.scale.setScalar(0.8 + Math.abs(Math.sin(t * 3)) * 0.35); g.rotation.z = Math.sin(t * 1.5) * 0.3; };
  }
  if (kind === 'sleepy') { // floating Zzz drawn with Poppins
    const tex = zTexture(font); const zs = [];
    for (let i = 0; i < 3; i++) { const z = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); g.add(z); zs.push(z); }
    g.userData.tick = t => zs.forEach((z, i) => { const k = (t * 0.35 + i / 3) % 1; z.position.set(0.66 + k * 0.32, 0.55 + k * 0.6, 0.3); z.scale.setScalar(Math.sin(k * Math.PI) * (0.7 + k * 0.6)); });
  }
  if (kind === 'celebrating') { // confetti
    const bits = Array.from({ length: 22 }, (_, i) => ({ x: ((i * 0.618) % 1) * 2.3 - 1.15, z: ((i * 0.37) % 1) * 0.8 - 0.1, speed: 0.35 + ((i * 0.43) % 1) * 0.35, off: (i * 0.29) % 1, spin: 2 + ((i * 0.71) % 1) * 4, color: [P.yellow, P.blue, P.magenta, '#7AD97A'][i % 4] }));
    const meshes = bits.map(b => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.012), new THREE.MeshStandardMaterial({ color: b.color, side: THREE.DoubleSide })); g.add(m); return m; });
    g.userData.tick = t => meshes.forEach((m, i) => { const b = bits[i], k = (t * b.speed + b.off) % 1; m.position.set(b.x + Math.sin(t * 2 + i) * 0.06, 1.35 - k * 2.4, b.z); m.rotation.set(t * b.spin, t * b.spin * 0.7, i); });
  }
  return g;
}
function zTexture(font) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = P.purple; x.font = `700 100px ${font}, Figtree, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Z', 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, 'rgba(176,48,106,.7)'); g.addColorStop(1, 'rgba(176,48,106,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

/* ---------- character + animation ---------- */
const damp = THREE.MathUtils.damp;
class Buddy {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.canvas = this.renderer.domElement; this.canvas.className = 'buddy-canvas';
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50); this.camera.position.set(0, 1.3, 5.2); this.camera.lookAt(0, 0.05, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#f6c9da', 0.9));
    const d1 = new THREE.DirectionalLight(0xffffff, 2.2); d1.position.set(3, 5, 6); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight('#FFE1EE', 0.9); d2.position.set(-4, 2, -3); this.scene.add(d2);
    this.font = 'Poppins';
    try { const ff = new FontFace('Poppins', `url(${FONT_URL})`, { weight: '700' }); ff.load().then(f => { document.fonts.add(f); this.fontReady = true; }).catch(() => {}); } catch {}
    this.logoTex = null;
    new THREE.TextureLoader().load(LOGO_URL, tex => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; this.logoTex = tex; this.rebuildCap(); });

    this.stage = new THREE.Group(); this.stage.position.y = 0.05; this.scene.add(this.stage);
    this.root = new THREE.Group(); this.stage.add(this.root);
    this.bodyG = new THREE.Group(); this.bodyG.position.set(0, -0.78, 0); this.root.add(this.bodyG);
    this.inner = new THREE.Group(); this.inner.position.set(0, 0.78, 0); this.bodyG.add(this.inner);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshPhysicalMaterial({ color: P.skin, roughness: 0.55, sheen: 0.25, sheenColor: new THREE.Color('#ffd6c4') }));
    body.position.y = BODY.y; body.scale.set(BODY.a, BODY.b, BODY.c); this.inner.add(body);
    this.inner.add(buildHeadphones()); this.cap = buildCap(null); this.inner.add(this.cap);
    this.antenna = new THREE.Group(); this.antenna.position.set(-0.86, 0.22, -0.05); this.antenna.rotation.z = 0.4;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.6, 12), std(P.cushion)); stem.position.y = 0.3; this.antenna.add(stem); this.antenna.add(orb([0, 0.64, 0], 0.1, P.magenta, true)); this.inner.add(this.antenna);
    this.hands = [-0.47, 0.47].map(x => { const h = new THREE.Group(); h.position.set(x, -0.36, 0.55); h.add(orb([0, 0, 0], [0.19, 0.21, 0.18], P.skin)); this.inner.add(h); return h; });
    this.feet = [-0.3, 0.3].map(x => { const f = new THREE.Group(); f.position.set(x, -0.74, 0.06); f.add(orb([0, -0.08, 0.08], [0.23, 0.14, 0.3], P.magenta, true)); this.root.add(f); return f; });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.92; this.scene.add(shadow);

    this.emotion = null; this.face = null; this.effect = null; this.blink = false; this.lastBlink = 0; this.changedAt = 0; this.yaw = 0;
    this.clock = new THREE.Clock(); this.raf = 0; this.el = null;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ro = new ResizeObserver(() => this.resize());
    this.setEmotion('happy');
  }
  rebuildCap() { if (this.cap) this.inner.remove(this.cap); this.cap = buildCap(this.logoTex); this.inner.add(this.cap); }
  disposeGroup(g) { g.traverse(o => { if (o.geometry && o.geometry !== sphereGeo) o.geometry.dispose(); }); }
  setEmotion(e) {
    if (e === this.emotion) return;
    this.emotion = e; this.changedAt = this.clock ? this.clock.getElapsedTime() : 0;
    this.refreshFace();
    if (this.effect) { this.stage.remove(this.effect); this.disposeGroup(this.effect); this.effect = null; }
    if (['critical', 'excited', 'surprised', 'determined', 'sleepy', 'celebrating'].includes(e)) { this.effect = makeEffect(e, this.font); (e === 'celebrating' ? this.stage : this.root).add(this.effect); }
  }
  refreshFace() {
    if (this.face) { this.inner.remove(this.face); this.disposeGroup(this.face); }
    this.face = buildFace(this.emotion, this.blink); this.inner.add(this.face);
  }
  setState({ health, reaction }) { this.setEmotion(reaction || emotionFromHealth(health)); }
  turn(dx) { this.yaw = dx > 0 ? -0.6 : dx < 0 ? 0.6 : 0; }
  attach(el, state) {
    if (state) this.setState(state);
    if (!el) return;
    if (this.el && this.el !== el) this.ro.unobserve(this.el);
    if (this.canvas.parentNode !== el) el.appendChild(this.canvas);
    this.el = el; this.ro.observe(el); this.resize();
    if (!this.raf) this.loop();
  }
  resize() {
    if (!this.el) return;
    const w = this.el.clientWidth || 300, h = this.el.clientHeight || 230;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    if (!this.canvas.isConnected) { cancelAnimationFrame(this.raf); this.raf = 0; return; } // paused until re-attached
    const dt = Math.min(0.05, this.clock.getDelta()), now = this.clock.getElapsedTime();
    const t = this.reduced ? 0 : now, since = now - this.changedAt, e = this.emotion;
    if (!this.reduced && now - this.lastBlink > 3.6 && !['critical', 'excited', 'sleepy', 'celebrating'].includes(e)) { this.lastBlink = now; this.blink = true; this.refreshFace(); setTimeout(() => { this.blink = false; if (this.canvas.isConnected) this.refreshFace(); }, 140); }
    const pop = this.reduced ? 0 : Math.exp(-since * 5) * Math.sin(since * 16) * 0.14;
    const s = (f, a, p = 0) => Math.sin(t * f + p) * a;
    let y = 0, x = 0, rx = 0, rz = 0, ry = 0.26 + Math.sin(t * 0.7) * 0.08, sq = 1;
    let hand = [[-0.47, -0.36, 0.55], [0.47, -0.36, 0.55]], kick = [0, 0];
    switch (e) {
      case 'critical': y = -0.03 + s(1.2, 0.02); rz = -0.09 + s(1.3, 0.025); rx = 0.06; hand = [[-0.43, -0.3 + s(9, 0.006), 0.58], [0.43, -0.3 + s(9, 0.006, 1), 0.58]]; break;
      case 'worried': y = s(1.7, 0.03); x = s(38, 0.005); rz = s(2, 0.03); hand = [[-0.46, -0.24, 0.56], [0.46, -0.24 + s(5, 0.01), 0.56]]; break;
      case 'happy': y = Math.abs(s(2.2, 0.06)); sq = 1 + s(4.4, 0.02); hand = [[-0.47, -0.34 + s(2.2, 0.02), 0.55], [0.47, -0.34 + s(2.2, 0.02, 1), 0.55]]; break;
      case 'excited': { const h = Math.abs(Math.sin(t * 3.6)); y = h * 0.22; sq = h < 0.2 ? 0.92 + h * 0.4 : 1 + h * 0.03; hand = [[-0.55, -0.18 + s(7.2, 0.08), 0.48], [0.55, -0.18 + s(7.2, 0.08, Math.PI), 0.48]]; kick = [0, h * 0.7]; break; }
      case 'sleepy': rx = 0.1 + s(0.9, 0.05); rz = 0.1 + s(0.45, 0.03); sq = 1 + s(1.4, 0.025); ry = 0.22; hand = [[-0.42, -0.42, 0.56], [0.36, -0.22, 0.62]]; break;
      case 'surprised': y = 0.06 + s(9, 0.008); sq = 1.03; rx = -0.06; hand = [[-0.53, -0.16, 0.5], [0.53, -0.16, 0.5]]; break;
      case 'determined': rx = 0.1; y = s(1.5, 0.02); ry = 0.2 + s(0.5, 0.04); hand = [[-0.4, -0.32 + s(3, 0.03), 0.66], [0.4, -0.32 + s(3, 0.03, 1.5), 0.66]]; break;
      case 'celebrating': { const h = Math.abs(Math.sin(t * 3.2)); y = h * 0.25; sq = h < 0.2 ? 0.93 + h * 0.35 : 1; ry = 0.26 + s(1.6, 0.35); hand = [[-0.64, 0.18 + s(8, 0.08), 0.3], [0.64, 0.18 + s(8, 0.08, 2), 0.3]]; kick = [h * 0.6, 0]; break; }
    }
    ry += this.yaw;
    const r = this.root, d = (cur, to, k = 9) => damp(cur, to, k, dt);
    r.position.x = d(r.position.x, x, 20); r.position.y = d(r.position.y, y, 14);
    r.rotation.x = d(r.rotation.x, rx); r.rotation.y = d(r.rotation.y, ry, 5); r.rotation.z = d(r.rotation.z, rz);
    const sy = sq * (1 + pop), sx = 1 / Math.sqrt(sy); this.bodyG.scale.set(sx, sy, sx);
    this.hands.forEach((h, i) => { const p = h.position; p.set(d(p.x, hand[i][0], 10), d(p.y, hand[i][1], 10), d(p.z, hand[i][2], 10)); });
    this.feet.forEach((f, i) => { f.rotation.x = d(f.rotation.x, -kick[i], 12); });
    this.antenna.rotation.z = 0.4 + s(3, 0.06) + (y - 0.05) * 0.4;
    if (this.effect && this.effect.userData.tick && !this.reduced) this.effect.userData.tick(now);
    this.renderer.render(this.scene, this.camera);
  }
}

let buddy = null;
window.Buddy3D = {
  attach(el, state) { try { if (!buddy) buddy = new Buddy(); buddy.attach(el, state); return true; } catch (e) { console.warn('[buddy3d]', e.message); return false; } },
  setState(state) { if (buddy) buddy.setState(state); },
  face(dx) { if (buddy) buddy.turn(dx); },
  emotionFromHealth,
};
document.dispatchEvent(new Event('buddy3d-ready'));
