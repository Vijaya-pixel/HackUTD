/* SafeT Buddy, the 3D mascot, ported one to one from the React Three Fiber component (BuddyMascot3D.tsx)
   to plain three.js so it runs in this no-build app. Same procedural geometry, palette, eight expressions,
   blink, bob, sway and wave. One renderer is kept alive and its canvas is moved into whatever `.pet3d`
   container the current render produced, so re-rendering the Learn tab never rebuilds the scene.

   window.Buddy3D.attach(el, { health, reaction })  — mount/move the canvas into el and update the expression
   window.Buddy3D.setState({ health, reaction })    — update without re-mounting */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const P = { cream: '#FFF1DF', magenta: '#E20074', pink: '#FF5A9E', dark: '#252029', white: '#FFF9F2', blue: '#7ACEE8' };
const std = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
const basic = color => new THREE.MeshBasicMaterial({ color });
const sphereGeo = new THREE.SphereGeometry(1, 24, 16);

export function emotionFromHealth(value) {
  const h = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return h <= 25 ? 'critical' : h <= 50 ? 'worried' : h <= 75 ? 'happy' : 'excited';
}
function orb(position, scale, color, mat) {
  const m = new THREE.Mesh(sphereGeo, mat || std(color, 0.83));
  m.position.set(...position); m.scale.set(...scale);
  return m;
}
function roundedBox(args, radius, smoothness, color) {
  return new THREE.Mesh(new RoundedBoxGeometry(args[0], args[1], args[2], smoothness, radius), std(color));
}
function textTexture(ch) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.clearRect(0, 0, 128, 128);
  x.fillStyle = P.magenta; x.font = '700 104px Figtree, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function buildMouth(emotion) {
  const sad = emotion === 'critical' || emotion === 'worried' || emotion === 'sleepy';
  if (emotion === 'surprised') return orb([0, -0.19, 0.035], [0.09, 0.13, 0.025], P.dark, basic(P.dark));
  const pts = (sad ? [[-0.16, -0.24, 0], [0, -0.16, 0], [0.16, -0.24, 0]] : [[-0.17, -0.16, 0], [0, -0.27, 0], [0.17, -0.16, 0]]).map(p => new THREE.Vector3(...p));
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.022, 8, false), basic(P.dark));
  m.position.z = 0.02;
  return m;
}
function buildFace(emotion) {
  const g = new THREE.Group(); g.position.set(0, 0.13, 0.505);
  const xEyes = emotion === 'critical', sleepy = emotion === 'sleepy';
  const eyes = [];
  for (const x of [-0.27, 0.27]) {
    const e = new THREE.Group(); e.position.set(x, 0.12, 0.02);
    if (xEyes) {
      for (const r of [Math.PI / 4, -Math.PI / 4]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.23, 0.025), basic(P.dark)); b.rotation.z = r; e.add(b); }
    } else { const eye = orb([0, 0, 0], [0.075, sleepy ? 0.018 : 0.115, 0.025], P.dark, basic(P.dark)); e.add(eye); eyes.push(eye); }
    g.add(e);
  }
  for (const x of [-0.43, 0.43]) g.add(orb([x, -0.11, 0.005], [0.115, 0.045, 0.014], P.pink));
  g.add(buildMouth(emotion));
  if (emotion === 'critical') {
    const d = new THREE.Group(); d.position.set(0.47, 0.3, 0.04);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.13, 16), std(P.blue)); cone.rotation.z = Math.PI; d.add(cone);
    d.add(orb([0, -0.05, 0], [0.055, 0.055, 0.04], P.blue)); g.add(d);
  }
  if (emotion === 'determined') {
    for (const [x, r] of [[-0.27, -0.22], [0.27, 0.22]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.025), basic(P.dark)); b.position.set(x, 0.29, 0.03); b.rotation.z = r; g.add(b); }
  }
  g.userData.eyes = eyes; g.userData.sleepy = sleepy;
  return g;
}
function buildHat() {
  const g = new THREE.Group(); g.position.set(0, 0.7, 0);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), std(P.white)); dome.scale.set(0.69, 0.38, 0.6); g.add(dome);
  g.add(orb([-0.42, 0.11, -0.04], [0.21, 0.23, 0.45], P.magenta));
  g.add(orb([0, -0.005, 0.43], [0.65, 0.07, 0.32], P.magenta));
  const t = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), new THREE.MeshBasicMaterial({ map: textTexture('T'), transparent: true }));
  t.position.set(0, 0.21, 0.49); g.add(t);
  return g;
}
function buildHeadphones() {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.075, 12, 48, Math.PI), std(P.magenta)); band.position.set(0, 0.45, -0.08); band.rotation.z = Math.PI / 2; g.add(band);
  for (const side of [-1, 1]) {
    const cup = new THREE.Group(); cup.position.set(side * 0.72, 0.05, 0);
    cup.add(roundedBox([0.22, 0.5, 0.43], 0.09, 4, P.magenta));
    cup.add(orb([side * 0.13, 0, 0], [0.04, 0.17, 0.17], P.dark)); g.add(cup);
  }
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.42, 12), std(P.dark)); boom.position.set(-0.81, 0.46, -0.06); boom.rotation.z = -0.2; g.add(boom);
  g.add(orb([-0.85, 0.68, -0.06], [0.07, 0.07, 0.07], P.magenta));
  return g;
}

class Buddy {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement; this.canvas.className = 'buddy-canvas';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50); this.camera.position.set(0, 0.15, 4.5); this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const d1 = new THREE.DirectionalLight(0xffffff, 2.2); d1.position.set(3, 5, 5); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xFFE4F0, 0.6); d2.position.set(-3, 2, -3); this.scene.add(d2);
    this.root = new THREE.Group(); this.scene.add(this.root);
    const body = roundedBox([1.3, 1.3, 0.95], 0.3, 6, P.cream); body.position.set(0, 0.04, 0); this.root.add(body);
    this.root.add(buildHeadphones()); this.root.add(buildHat());
    this.hand = new THREE.Group(); this.hand.position.set(-0.63, -0.44, 0.38); this.hand.add(orb([0, 0, 0], [0.19, 0.19, 0.19], P.cream)); this.root.add(this.hand);
    this.root.add(orb([0.63, -0.44, 0.38], [0.19, 0.19, 0.19], P.cream));
    for (const x of [-0.36, 0.36]) this.root.add(orb([x, -0.75, 0.22], [0.28, 0.17, 0.33], P.magenta));
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.2, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.08; this.scene.add(shadow);
    this.emotion = null; this.face = null; this.setEmotion('happy');
    this.clock = new THREE.Clock(); this.blink = false; this.lastBlink = 0; this.raf = 0; this.el = null;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ro = new ResizeObserver(() => this.resize());
  }
  setEmotion(e) {
    if (e === this.emotion) return;
    if (this.face) { this.root.remove(this.face); this.face.traverse(o => { if (o.geometry && o.geometry !== sphereGeo) o.geometry.dispose(); }); }
    this.face = buildFace(e); this.root.add(this.face); this.emotion = e;
  }
  setState({ health, reaction }) { this.setEmotion(reaction || emotionFromHealth(health)); }
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
    const t = this.clock.getElapsedTime();
    if (!this.reduced) {
      const energetic = this.emotion === 'excited' || this.emotion === 'celebrating';
      this.root.position.y = Math.sin(t * (energetic ? 3 : 1.7)) * (energetic ? 0.09 : 0.045);
      this.root.rotation.y = Math.sin(t * 0.7) * 0.085;
      this.root.rotation.z = this.emotion === 'critical' ? -0.06 : Math.sin(t * 0.85) * 0.025;
      this.hand.rotation.z = energetic ? Math.sin(t * 5) * 0.4 : 0;
      if (t - this.lastBlink > 3.8) { this.lastBlink = t; this.blink = true; setTimeout(() => { this.blink = false; }, 150); }
      const eyes = this.face?.userData.eyes || [];
      for (const e of eyes) e.scale.y = this.blink || this.face.userData.sleepy ? 0.018 : 0.115;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

let buddy = null;
window.Buddy3D = {
  attach(el, state) { try { if (!buddy) buddy = new Buddy(); buddy.attach(el, state); return true; } catch (e) { console.warn('[buddy3d]', e.message); return false; } },
  setState(state) { if (buddy) buddy.setState(state); },
  emotionFromHealth,
};
document.dispatchEvent(new Event('buddy3d-ready'));
