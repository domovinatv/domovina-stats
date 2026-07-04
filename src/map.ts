// map.ts — /map: WebGL2 point-cloud vektorske mape korpusa (UMAP projekcija
// chunk embeddinga). Bez ovisnosti — 136k+ točaka je trivijalno za gl.POINTS.
//
// Data contract (producer: domovina-rag/scripts/emit_vector_map.py):
//   /vector-map.bin     N × 4 × uint16 LE: x, y (kvantizirano [0,65535]),
//                       ep_idx (indeks u meta.episodes), t_sec (start u epizodi)
//   /vector-map-3d.bin  N × 3 × uint16 LE: x, y, z — zaseban UMAP 3D fit, ISTI
//                       poredak točaka (lazy-load tek na 3D toggle)
//   /vector-map.json    { generated_at, points, channels[], episodes:
//                        [[yid, chanIdx, title, date]…], clusters:
//                        [{label, x, y, x3, y3, z3, n}…] }
//
// Dva prikaza: 2D (default, analitički standard) + 3D toggle (rotacija, dubina).
// Klasteri = HDBSCAN + Gemini imena (producer); ovdje samo zoom-ovisan HTML
// overlay s greedy anti-overlapom — kao imena gradova na karti.
//
// Boje: top 8 kanala = kategorički slotovi (fiksni redoslijed, nikad cycle),
// svi ostali = agregat siva. Identitet nikad samo bojom: legenda nosi vidljive
// labele, tooltip imenuje kanal.
//
// Otvaranje epizode ide na domovina.ai player (/v/{id}/t/{sec}), NE na YouTube.
// UX po ulazu: miš = hover tooltip + klik otvara video; dodir (mobile) = tap
// pokaže snackbar s naslovom + "Otvori" linkom ili dismiss.

import "./theme.css";
import "./map.css";
import { h, showTooltip, hideTooltip } from "./dom.ts";
import { num, compact, shortDate, generatedLabel } from "./format.ts";

interface Cluster {
  label: string;
  x: number; y: number;
  x3: number; y3: number; z3: number;
  n: number;
}

interface MapMeta {
  schema_version?: number;
  generated_at: string;
  points: number;
  channels: string[];
  /** [youtube_id, channel_idx, title, date] */
  episodes: [string, number, string, string][];
  clusters?: Cluster[];
}

const SLOTS = 8; // kategoričkih slotova; slot 8 = agregat "Ostali"
const PAL_LIGHT = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834", "#8a95a5"];
const PAL_DARK = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926", "#6b7480"];
const PERSP = 1.9; // udaljenost kamere u world jedinicama (blaga perspektiva)

const app = document.querySelector<HTMLDivElement>("#app")!;

// ── shaderi ──────────────────────────────────────────────────────────────────
const VS2D = `#version 300 es
in vec2 a_pos;      // world [0,1]²
in float a_slot;    // 0..8 (8 = agregat)
uniform vec4 u_view;   // sx, sy, tx, ty  (clip = pos*s + t)
uniform float u_size;  // px * dpr
uniform float u_filter; // -1 = sve, inače slot
out float v_slot;
out float v_alpha;
void main() {
  gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);
  gl_PointSize = u_size;
  v_slot = a_slot;
  bool dim = u_filter >= 0.0 && abs(a_slot - u_filter) > 0.5;
  v_alpha = dim ? 0.05 : 0.55;
}`;

const VS3D = `#version 300 es
in vec3 a_pos;      // world [0,1]³
in float a_slot;
uniform mat3 u_rot;
uniform vec3 u_proj;   // zoom*2m/W, zoom*2m/H, PERSP
uniform float u_size;
uniform float u_filter;
out float v_slot;
out float v_alpha;
void main() {
  vec3 p = u_rot * (a_pos - 0.5);
  float s = u_proj.z / (u_proj.z - p.z);
  gl_Position = vec4(p.x * s * u_proj.x, p.y * s * u_proj.y, 0.0, 1.0);
  gl_PointSize = u_size * s;
  v_slot = a_slot;
  bool dim = u_filter >= 0.0 && abs(a_slot - u_filter) > 0.5;
  // dublje točke tamnije/prozirnije — jeftin depth cue bez sortiranja
  v_alpha = (dim ? 0.05 : 0.55) * mix(0.30, 1.0, smoothstep(-0.55, 0.55, p.z));
}`;

const FS = `#version 300 es
precision mediump float;
in float v_slot;
in float v_alpha;
uniform vec3 u_pal[9];
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = v_alpha * (1.0 - smoothstep(0.6, 1.0, d));
  outColor = vec4(u_pal[int(v_slot + 0.5)], a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile fail");
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog) ?? "link fail");
  return prog;
}

function hex2rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function fmtT(sec: number): string {
  return `${(sec / 60) | 0}:${String(sec % 60).padStart(2, "0")}`;
}

function videoUrl(yid: string, sec: number): string {
  return `https://domovina.ai/v/${yid}/t/${sec}`;
}

// ── spatial grid za 2D hover picking (svjetske koordinate [0,1]²) ────────────
const GRID = 256;

function buildGrid(px: Float32Array, n: number) {
  const cell = new Int32Array(n);
  const count = new Int32Array(GRID * GRID + 1);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(GRID - 1, (px[i * 2] * GRID) | 0);
    const cy = Math.min(GRID - 1, (px[i * 2 + 1] * GRID) | 0);
    cell[i] = cy * GRID + cx;
    count[cell[i] + 1]++;
  }
  for (let c = 0; c < GRID * GRID; c++) count[c + 1] += count[c];
  const order = new Int32Array(n);
  const cursor = count.slice(0, GRID * GRID);
  for (let i = 0; i < n; i++) order[cursor[cell[i]]++] = i;
  return { start: count, order };
}

// ── stranica ─────────────────────────────────────────────────────────────────
function shell(): { card: HTMLElement; sub: HTMLElement } {
  const wrap = h("div", { class: "wrap" });
  const hero = h("header", { class: "hero" });
  hero.appendChild(h("a", { class: "backlink", href: "/" }, "← DOMOVINA.ai u brojkama"));
  hero.appendChild(h("h1", {}, "Semantička mapa korpusa"));
  const sub = h("p", { class: "sub" }, "Učitavam mapu…");
  hero.appendChild(sub);
  const card = h("section", { class: "card" });
  wrap.append(hero, card);
  app.replaceChildren(wrap);
  return { card, sub };
}

function fail(card: HTMLElement, sub: HTMLElement, msg: string): void {
  sub.textContent = "Mapa trenutno nije dostupna.";
  card.replaceChildren(h("div", { class: "err" }, msg));
}

async function init(): Promise<void> {
  const { card, sub } = shell();

  let meta: MapMeta;
  let raw: Uint16Array;
  try {
    const [mRes, bRes] = await Promise.all([fetch("/vector-map.json"), fetch("/vector-map.bin")]);
    if (!mRes.ok || !bRes.ok) throw new Error(`HTTP ${mRes.status}/${bRes.status}`);
    meta = await mRes.json();
    raw = new Uint16Array(await bRes.arrayBuffer());
  } catch (e) {
    fail(card, sub, `Snapshot mape još nije generiran (${e instanceof Error ? e.message : e}).`);
    return;
  }
  const n = raw.length >> 2;
  // label može biti "" (LLM nedostupan pri generiranju) — takve regije preskačemo
  const clusters = (meta.clusters ?? []).filter((c) => c.label);

  sub.textContent =
    `${num(n)} isječaka transkripata kao točke — UMAP projekcija 1024-dimenzionalnih ` +
    `semantičkih embeddinga. Bliske točke govore o sličnim temama. ` +
    `${generatedLabel(meta.generated_at)}`;

  // ── atributi + brojanje po kanalu ──
  const pos = new Float32Array(n * 2);
  const slot = new Uint8Array(n);
  const chanPts = new Uint32Array(meta.channels.length);
  for (let i = 0; i < n; i++) {
    pos[i * 2] = raw[i * 4] / 65535;
    pos[i * 2 + 1] = raw[i * 4 + 1] / 65535;
    const ci = meta.episodes[raw[i * 4 + 2]]?.[1] ?? 0;
    chanPts[ci]++;
    slot[i] = Math.min(ci, SLOTS);
  }
  const grid = buildGrid(pos, n);
  let pos3: Float32Array | null = null; // lazy (tek na 3D toggle)

  // ── mode toggle + legenda ──
  let mode: "2d" | "3d" = "2d";
  const controls = h("div", { class: "map-controls" });
  const legend = h("div", { class: "legend", role: "group", "aria-label": "Filtar po kanalu" });
  const modeSwitch = h("div", { class: "mode-switch", role: "group", "aria-label": "Prikaz" });
  const btn2d = h("button", { class: "mode-btn on", type: "button", "aria-pressed": "true" }, "2D");
  const btn3d = h("button", { class: "mode-btn", type: "button", "aria-pressed": "false" }, "3D");
  modeSwitch.append(btn2d, btn3d);
  controls.append(legend, modeSwitch);

  let filter = -1; // -1 = sve; 0..7 kanal-slot; 8 = "Ostali"
  const chips: HTMLElement[] = [];
  const chip = (label: string, count: number, s: number, color?: string): void => {
    const b = h("button", { class: "chip", type: "button", "aria-pressed": "false" });
    const sw = h("span", { class: "sw" });
    if (color) sw.style.setProperty("--c", color);
    b.append(sw, h("span", {}, label), h("span", { class: "n" }, compact(count)));
    b.addEventListener("click", () => {
      filter = filter === s ? -1 : s;
      for (const [j, c] of chips.entries()) {
        c.classList.toggle("on", j === filter);
        c.setAttribute("aria-pressed", String(j === filter));
      }
      legend.classList.toggle("filtered", filter >= 0);
      requestRender();
    });
    chips.push(b);
    legend.appendChild(b);
  };
  const topN = Math.min(SLOTS, meta.channels.length);
  for (let s = 0; s < topN; s++) chip(meta.channels[s], chanPts[s], s, `var(--cat-${s + 1})`);
  if (meta.channels.length > SLOTS) {
    let rest = 0;
    for (let c = SLOTS; c < meta.channels.length; c++) rest += chanPts[c];
    chip(`Ostali (${meta.channels.length - SLOTS} kanala)`, rest, SLOTS);
  }

  // ── canvas + overlay slojevi ──
  const stage = h("div", { class: "map-stage" });
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Točkasta mapa ${num(n)} isječaka korpusa, grupirano po semantičkoj sličnosti`);
  const labelsWrap = h("div", { class: "clabels", "aria-hidden": "true" });
  const labelEls = clusters.map((c) => {
    const el = h("div", { class: "clabel" }, c.label);
    labelsWrap.appendChild(el);
    return el;
  });
  const ring = h("div", { class: "pick-ring" });
  const hint = h("div", { class: "hint" });
  const snack = h("div", { class: "snack", role: "status" });
  stage.append(canvas, labelsWrap, ring, hint, snack);
  card.append(controls, stage, h("p", { class: "map-note" },
    "Raspored računa UMAP (metrika: kosinusna sličnost) nad bge-m3 embeddinzima — " +
    "isti vektori koje pretražuje MCP alat search_podcasts. Nazivi tema: HDBSCAN " +
    "klasteri imenovani Gemini modelom. Osi nemaju mjernu jedinicu; značenje nosi " +
    "samo blizina točaka."));

  const setHint = () => {
    hint.textContent = mode === "2d"
      ? "kotačić = zoom · povlačenje = pomak · klik na točku = video"
      : "kotačić = zoom · povlačenje = rotacija · klik na točku = video";
  };
  setHint();

  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true });
  if (!gl) {
    fail(card, sub, "WebGL2 nije dostupan u ovom pregledniku — mapa se ne može prikazati.");
    return;
  }
  const prog2d = link(gl, VS2D);
  const prog3d = link(gl, VS3D);

  const makeVao = (posData: Float32Array, comps: number, prog: WebGLProgram): WebGLVertexArrayObject => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.STATIC_DRAW);
    const locPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, comps, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, slot, gl.STATIC_DRAW);
    const locSlot = gl.getAttribLocation(prog, "a_slot");
    gl.enableVertexAttribArray(locSlot);
    gl.vertexAttribPointer(locSlot, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  };
  const vao2d = makeVao(pos, 2, prog2d);
  let vao3d: WebGLVertexArrayObject | null = null;

  const uni = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  const setPalette = () => {
    const pal = (darkMq.matches ? PAL_DARK : PAL_LIGHT).flatMap(hex2rgb);
    for (const p of [prog2d, prog3d]) {
      gl.useProgram(p);
      gl.uniform3fv(uni(p, "u_pal"), pal);
    }
  };
  setPalette();
  darkMq.addEventListener("change", () => { setPalette(); requestRender(); });

  // ── view state ──
  const view = { cx: 0.5, cy: 0.5, zoom: 0.94 };           // 2D
  const view3 = { yaw: 0.6, pitch: -0.35, zoom: 0.86 };    // 3D
  let autoRotate = true;
  let W = 1, H = 1, dpr = 1;

  // 2D transformi
  const clipScale = (): [number, number] => {
    const m = Math.min(W, H);
    return [2 * view.zoom * (m / W), -2 * view.zoom * (m / H)];
  };
  const worldAt = (px: number, py: number): [number, number] => {
    const [sx, sy] = clipScale();
    return [((px / W) * 2 - 1) / sx + view.cx, (1 - (py / H) * 2) / sy + view.cy];
  };
  const screenAt = (wx: number, wy: number): [number, number] => {
    const [sx, sy] = clipScale();
    return [((wx - view.cx) * sx + 1) / 2 * W, (1 - (wy - view.cy) * sy) / 2 * H];
  };

  // 3D transformi (CPU zrcalo shader matematike — za picking, ring, labele)
  const rot = new Float32Array(9);
  const updateRot = (): void => {
    const cy = Math.cos(view3.yaw), sy = Math.sin(view3.yaw);
    const cx = Math.cos(view3.pitch), sx = Math.sin(view3.pitch);
    // Rx(pitch)·Ry(yaw), column-major za uniformMatrix3fv
    rot[0] = cy; rot[1] = sx * sy; rot[2] = -cx * sy;
    rot[3] = 0; rot[4] = cx; rot[5] = sx;
    rot[6] = sy; rot[7] = -sx * cy; rot[8] = cx * cy;
  };
  /** world [0,1]³ → [screenX, screenY, depth p.z] u trenutnoj rotaciji. */
  const project3 = (wx: number, wy: number, wz: number): [number, number, number] => {
    const x = wx - 0.5, y = wy - 0.5, z = wz - 0.5;
    const px = rot[0] * x + rot[3] * y + rot[6] * z;
    const py = rot[1] * x + rot[4] * y + rot[7] * z;
    const pz = rot[2] * x + rot[5] * y + rot[8] * z;
    const m = Math.min(W, H);
    const s = PERSP / (PERSP - pz);
    const cxl = px * s * view3.zoom * 2 * (m / W);
    const cyl = py * s * view3.zoom * 2 * (m / H);
    return [(cxl + 1) / 2 * W, (1 - cyl) / 2 * H, pz];
  };

  // ── render ──
  let rafPending = false;
  function requestRender(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame((ts) => { rafPending = false; draw(ts); });
  }
  let lastTs = 0;
  function draw(ts = 0): void {
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    if (mode === "2d") {
      const [sx, sy] = clipScale();
      gl!.useProgram(prog2d);
      gl!.bindVertexArray(vao2d);
      gl!.uniform4f(uni(prog2d, "u_view"), sx, sy, -view.cx * sx, -view.cy * sy);
      gl!.uniform1f(uni(prog2d, "u_size"), Math.max(1.5, 2.1 * Math.pow(view.zoom, 0.45)) * dpr);
      gl!.uniform1f(uni(prog2d, "u_filter"), filter);
      gl!.drawArrays(gl!.POINTS, 0, n);
    } else if (vao3d) {
      if (autoRotate) {
        view3.yaw += Math.min(0.05, (ts - lastTs) / 1000) * 0.18;
      }
      updateRot();
      const m = Math.min(W, H);
      gl!.useProgram(prog3d);
      gl!.bindVertexArray(vao3d);
      gl!.uniformMatrix3fv(uni(prog3d, "u_rot"), false, rot);
      gl!.uniform3f(uni(prog3d, "u_proj"), view3.zoom * 2 * (m / W), view3.zoom * 2 * (m / H), PERSP);
      gl!.uniform1f(uni(prog3d, "u_size"), Math.max(1.5, 2.0 * Math.pow(view3.zoom, 0.45)) * dpr);
      gl!.uniform1f(uni(prog3d, "u_filter"), filter);
      gl!.drawArrays(gl!.POINTS, 0, n);
    }
    gl!.bindVertexArray(null);
    lastTs = ts;
    positionRing();
    positionLabels();
    if (mode === "3d" && autoRotate) requestRender(); // kontinuirana rotacija
  }

  // ── labele klastera (zoom-ovisno, greedy anti-overlap) ──
  function positionLabels(): void {
    if (!clusters.length) return;
    const zoom = mode === "2d" ? view.zoom : view3.zoom;
    const maxK = Math.min(clusters.length, Math.round(7 * Math.pow(zoom, 1.2)) + 5);
    const placed: [number, number][] = [];
    clusters.forEach((c, ci) => {
      const el = labelEls[ci];
      let x: number, y: number, depth = 1;
      if (mode === "2d") {
        [x, y] = screenAt(c.x / 65535, c.y / 65535);
      } else {
        const [px, py, pz] = project3(c.x3 / 65535, c.y3 / 65535, c.z3 / 65535);
        x = px; y = py;
        depth = 0.35 + 0.65 * Math.min(1, Math.max(0, (pz + 0.55) / 1.1));
      }
      let ok = ci < maxK && x > 10 && x < W - 10 && y > 14 && y < H - 14;
      if (ok) {
        for (const [ox, oy] of placed) {
          if (Math.abs(x - ox) < 110 && Math.abs(y - oy) < 26) { ok = false; break; }
        }
      }
      if (!ok) { el.style.opacity = "0"; return; }
      placed.push([x, y]);
      el.style.opacity = String(mode === "2d" ? 0.9 : 0.9 * depth);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      el.style.fontSize = `${Math.min(15, 10.5 + Math.log2(1 + c.n / 1500))}px`;
    });
  }

  const ro = new ResizeObserver(() => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth; H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    requestRender();
  });
  ro.observe(stage);

  // ── mode switch ──
  async function setMode(m2: "2d" | "3d"): Promise<void> {
    if (mode === m2) return;
    if (m2 === "3d" && !pos3) {
      btn3d.textContent = "…";
      try {
        const r = await fetch("/vector-map-3d.bin");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const q3 = new Uint16Array(await r.arrayBuffer());
        pos3 = new Float32Array(q3.length);
        for (let i = 0; i < q3.length; i++) pos3[i] = q3[i] / 65535;
        vao3d = makeVao(pos3, 3, prog3d);
      } catch {
        btn3d.textContent = "3D";
        btn3d.setAttribute("disabled", "");
        btn3d.title = "3D snapshot nije dostupan";
        return;
      }
      btn3d.textContent = "3D";
    }
    mode = m2;
    autoRotate = mode === "3d";
    btn2d.classList.toggle("on", mode === "2d");
    btn3d.classList.toggle("on", mode === "3d");
    btn2d.setAttribute("aria-pressed", String(mode === "2d"));
    btn3d.setAttribute("aria-pressed", String(mode === "3d"));
    picked = -1;
    hideTooltip();
    hideSnack();
    setHint();
    requestRender();
  }
  btn2d.addEventListener("click", () => { void setMode("2d"); });
  btn3d.addEventListener("click", () => { void setMode("3d"); });

  // ── picking ──
  let picked = -1;
  function pick2(px: number, py: number): number {
    const [wx, wy] = worldAt(px, py);
    const m = Math.min(W, H);
    const r = 9 / (view.zoom * m);
    const r2 = r * r;
    let best = -1, bestD = r2;
    const c0x = Math.max(0, ((wx - r) * GRID) | 0), c1x = Math.min(GRID - 1, ((wx + r) * GRID) | 0);
    const c0y = Math.max(0, ((wy - r) * GRID) | 0), c1y = Math.min(GRID - 1, ((wy + r) * GRID) | 0);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const c = cy * GRID + cx;
      for (let k = grid.start[c]; k < grid.start[c + 1]; k++) {
        const i = grid.order[k];
        if (filter >= 0 && slot[i] !== filter) continue;
        const dx = pos[i * 2] - wx, dy = pos[i * 2 + 1] - wy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }
  function pick3(px: number, py: number): number {
    // brute force projekcija svih točaka (~136k × 15 flops ≈ ms) — bliža (veći
    // depth) pobjeđuje kod izjednačenih udaljenosti
    if (!pos3) return -1;
    let best = -1, bestScore = 81; // 9px²
    for (let i = 0; i < n; i++) {
      if (filter >= 0 && slot[i] !== filter) continue;
      const [sx, sy, pz] = project3(pos3[i * 3], pos3[i * 3 + 1], pos3[i * 3 + 2]);
      const dx = sx - px, dy = sy - py;
      const d = dx * dx + dy * dy - pz * 4; // blagi bias prema bližima
      if (dx * dx + dy * dy <= 81 && d < bestScore) { bestScore = d; best = i; }
    }
    return best;
  }
  const pickAt = (px: number, py: number): number => (mode === "2d" ? pick2(px, py) : pick3(px, py));

  function positionRing(): void {
    if (picked < 0) { ring.style.display = "none"; return; }
    const [x, y] = mode === "2d"
      ? screenAt(pos[picked * 2], pos[picked * 2 + 1])
      : project3(pos3![picked * 3], pos3![picked * 3 + 1], pos3![picked * 3 + 2]);
    ring.style.display = "block";
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
  }
  function setPicked(i: number, clientX: number, clientY: number): void {
    picked = i;
    canvas.classList.toggle("pt", i >= 0);
    positionRing();
    if (i < 0) { hideTooltip(); return; }
    const ep = meta.episodes[raw[i * 4 + 2]];
    showTooltip(clientX, clientY, ep[3] ? shortDate(ep[3]) : "", ep[2] || ep[0], "", [
      { label: "Kanal", value: meta.channels[ep[1]] ?? "?" },
      { label: "Trenutak", value: fmtT(raw[i * 4 + 3]) },
    ]);
  }

  // ── snackbar (touch UX: tap → naslov + link, umjesto hover tooltipa) ──
  function hideSnack(): void {
    snack.classList.remove("on");
    picked = -1;
    positionRing();
  }
  function showSnack(i: number): void {
    picked = i;
    positionRing();
    const ep = meta.episodes[raw[i * 4 + 2]];
    const t = raw[i * 4 + 3];
    snack.replaceChildren();
    const info = h("div", { class: "snack-info" });
    info.append(
      h("div", { class: "snack-title" }, ep[2] || ep[0]),
      h("div", { class: "snack-sub" },
        [meta.channels[ep[1]] ?? "?", ep[3] ? shortDate(ep[3]) : "", fmtT(t)].filter(Boolean).join(" · ")),
    );
    const open = h("a", {
      class: "snack-open", href: videoUrl(ep[0], t), target: "_blank", rel: "noopener",
    }, "Otvori ↗");
    const close = h("button", { class: "snack-x", type: "button", "aria-label": "Zatvori" }, "×");
    close.addEventListener("click", hideSnack);
    snack.append(info, open, close);
    snack.classList.add("on");
  }

  // ── interakcija: drag pan/rotacija, pinch/wheel zoom, klik ──
  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = false, pinchD = 0;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchD = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) { // hover
      setPicked(pickAt(e.offsetX, e.offsetY), e.clientX, e.clientY);
      return;
    }
    const cur = { x: e.offsetX, y: e.offsetY };
    if (pointers.size === 1) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (mode === "2d") {
        const [sx, sy] = clipScale();
        view.cx -= (dx / W) * 2 / sx;
        view.cy -= (-dy / H) * 2 / sy;
      } else {
        autoRotate = false;
        view3.yaw += dx * 0.006;
        view3.pitch = Math.min(1.35, Math.max(-1.35, view3.pitch - dy * 0.006));
      }
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        dragged = true;
        canvas.classList.add("drag");
        hideTooltip();
      }
      pointers.set(e.pointerId, cur);
      requestRender();
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchD);
      pinchD = d;
      dragged = true;
    }
  });
  const endPointer = (e: PointerEvent) => {
    if (pointers.has(e.pointerId) && pointers.size === 1 && !dragged) {
      const i = pickAt(e.offsetX, e.offsetY);
      if (e.pointerType === "touch") {
        // tap: snackbar (naslov + link) umjesto slijepog otvaranja novog taba
        if (i >= 0) showSnack(i);
        else hideSnack();
      } else if (i >= 0) {
        const ep = meta.episodes[raw[i * 4 + 2]];
        window.open(videoUrl(ep[0], raw[i * 4 + 3]), "_blank", "noopener");
      }
    }
    pointers.delete(e.pointerId);
    pinchD = 0;
    canvas.classList.remove("drag");
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", () => { if (!pointers.size) setPicked(-1, 0, 0); });

  function zoomAt(px: number, py: number, factor: number): void {
    if (mode === "2d") {
      const [wx, wy] = worldAt(px, py);
      view.zoom = Math.min(60, Math.max(0.4, view.zoom * factor));
      const [wx2, wy2] = worldAt(px, py);
      view.cx += wx - wx2;
      view.cy += wy - wy2;
    } else {
      view3.zoom = Math.min(10, Math.max(0.45, view3.zoom * factor));
    }
    requestRender();
  }
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0016));
  }, { passive: false });
}

init().catch((e) => {
  app.replaceChildren(h("div", { class: "wrap" },
    `Greška pri učitavanju mape: ${e instanceof Error ? e.message : e}`));
});
