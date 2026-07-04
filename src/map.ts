// map.ts — /map: WebGL2 point-cloud vektorske mape korpusa (UMAP 2D projekcija
// chunk embeddinga). Bez ovisnosti — 136k+ točaka je trivijalno za gl.POINTS.
//
// Data contract (producer: domovina-rag/scripts/emit_vector_map.py):
//   /vector-map.bin   N × 4 × uint16 LE: x, y (kvantizirano [0,65535]),
//                     ep_idx (indeks u meta.episodes), t_sec (start u epizodi)
//   /vector-map.json  { generated_at, points, channels[], episodes: [[yid, chanIdx, title, date]…] }
//
// Boje: top 8 kanala = kategorički slotovi (fiksni redoslijed, nikad cycle),
// svi ostali = agregat siva. Identitet nikad samo bojom: legenda nosi vidljive
// labele, tooltip imenuje kanal.
//
// Otvaranje epizode ide na domovina.ai player (/v/{id}/t/{sec}), NE na YouTube.
// UX po ulazu: miš = hover tooltip (naslov/kanal/trenutak) + klik otvara video;
// dodir (mobile) = tap pokaže snackbar s naslovom + "Otvori" linkom ili dismiss
// (nema hovera, a slijepi tap koji odmah otvara novi tab bio bi agresivan).

import "./theme.css";
import "./map.css";
import { h, showTooltip, hideTooltip } from "./dom.ts";
import { num, compact, shortDate, generatedLabel } from "./format.ts";

interface MapMeta {
  schema_version?: number;
  generated_at: string;
  points: number;
  channels: string[];
  /** [youtube_id, channel_idx, title, date] */
  episodes: [string, number, string, string][];
}

const SLOTS = 8; // kategoričkih slotova; slot 8 = agregat "Ostali"
const PAL_LIGHT = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834", "#8a95a5"];
const PAL_DARK = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926", "#6b7480"];

const app = document.querySelector<HTMLDivElement>("#app")!;

// ── shaderi ──────────────────────────────────────────────────────────────────
const VS = `#version 300 es
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

// ── spatial grid za hover picking (svjetske koordinate [0,1]²) ───────────────
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

  let meta: MapMeta, raw: Uint16Array;
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

  sub.textContent =
    `${num(n)} isječaka transkripata kao točke — UMAP projekcija 1024-dimenzionalnih ` +
    `semantičkih embeddinga u 2D. Bliske točke govore o sličnim temama. ` +
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

  // ── legenda ──
  let filter = -1; // -1 = sve; 0..7 kanal-slot; 8 = "Ostali"
  const legend = h("div", { class: "legend", role: "group", "aria-label": "Filtar po kanalu" });
  const chips: HTMLElement[] = [];
  const chip = (label: string, count: number, s: number, color?: string): HTMLElement => {
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
    return b;
  };
  const topN = Math.min(SLOTS, meta.channels.length);
  for (let s = 0; s < topN; s++) chip(meta.channels[s], chanPts[s], s, `var(--cat-${s + 1})`);
  if (meta.channels.length > SLOTS) {
    let rest = 0;
    for (let c = SLOTS; c < meta.channels.length; c++) rest += chanPts[c];
    chip(`Ostali (${meta.channels.length - SLOTS} kanala)`, rest, SLOTS);
  }

  // ── canvas + WebGL ──
  const stage = h("div", { class: "map-stage" });
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Točkasta mapa ${num(n)} isječaka korpusa, grupirano po semantičkoj sličnosti`);
  const ring = h("div", { class: "pick-ring" });
  const hint = h("div", { class: "hint" }, "kotačić = zoom · povlačenje = pomak · klik na točku = video");
  const snack = h("div", { class: "snack", role: "status" });
  stage.append(canvas, ring, hint, snack);
  card.append(legend, stage, h("p", { class: "map-note" },
    "Raspored računa UMAP (metrika: kosinusna sličnost) nad bge-m3 embeddinzima — " +
    "isti vektori koje pretražuje MCP alat search_podcasts. Osi nemaju mjernu jedinicu; " +
    "značenje nosi samo blizina točaka."));

  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true });
  if (!gl) {
    fail(card, sub, "WebGL2 nije dostupan u ovom pregledniku — mapa se ne može prikazati.");
    return;
  }
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog) ?? "link fail");
  gl.useProgram(prog);

  const buf = (data: ArrayBufferView, loc: number, size: number, type: number) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, false, 0, 0);
  };
  buf(pos, gl.getAttribLocation(prog, "a_pos"), 2, gl.FLOAT);
  buf(slot, gl.getAttribLocation(prog, "a_slot"), 1, gl.UNSIGNED_BYTE);

  const uView = gl.getUniformLocation(prog, "u_view");
  const uSize = gl.getUniformLocation(prog, "u_size");
  const uFilter = gl.getUniformLocation(prog, "u_filter");
  const uPal = gl.getUniformLocation(prog, "u_pal");
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  const setPalette = () => {
    const pal = (darkMq.matches ? PAL_DARK : PAL_LIGHT).flatMap(hex2rgb);
    gl.uniform3fv(uPal, pal);
  };
  setPalette();
  darkMq.addEventListener("change", () => { setPalette(); requestRender(); });

  // ── view (pan/zoom) ──
  const view = { cx: 0.5, cy: 0.5, zoom: 0.94 };
  let W = 1, H = 1, dpr = 1;

  const clipScale = (): [number, number] => {
    const m = Math.min(W, H);
    return [2 * view.zoom * (m / W), -2 * view.zoom * (m / H)];
  };
  const worldAt = (px: number, py: number): [number, number] => {
    const [sx, sy] = clipScale();
    const cxl = (px / W) * 2 - 1;
    const cyl = 1 - (py / H) * 2;
    return [cxl / sx + view.cx, cyl / sy + view.cy];
  };
  const screenAt = (wx: number, wy: number): [number, number] => {
    const [sx, sy] = clipScale();
    return [((wx - view.cx) * sx + 1) / 2 * W, (1 - ((wy - view.cy) * sy)) / 2 * H];
  };

  let rafPending = false;
  function requestRender(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; draw(); });
  }
  function draw(): void {
    const [sx, sy] = clipScale();
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.uniform4f(uView, sx, sy, -view.cx * sx, -view.cy * sy);
    gl!.uniform1f(uSize, Math.max(1.5, 2.1 * Math.pow(view.zoom, 0.45)) * dpr);
    gl!.uniform1f(uFilter, filter);
    gl!.drawArrays(gl!.POINTS, 0, n);
    positionRing();
  }

  const ro = new ResizeObserver(() => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth; H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    requestRender();
  });
  ro.observe(stage);

  // ── picking ──
  let picked = -1;
  function pick(px: number, py: number): number {
    const [wx, wy] = worldAt(px, py);
    const m = Math.min(W, H);
    const r = 9 / (2 * view.zoom * m) * 2; // ~9 px u world jedinicama
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
  function positionRing(): void {
    if (picked < 0) { ring.style.display = "none"; return; }
    const [x, y] = screenAt(pos[picked * 2], pos[picked * 2 + 1]);
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

  // ── interakcija: drag pan, pinch zoom, wheel zoom, klik ──
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
      setPicked(pick(e.offsetX, e.offsetY), e.clientX, e.clientY);
      return;
    }
    const cur = { x: e.offsetX, y: e.offsetY };
    if (pointers.size === 1) {
      const [sx, sy] = clipScale();
      view.cx -= ((cur.x - prev.x) / W) * 2 / sx;
      view.cy -= (-(cur.y - prev.y) / H) * 2 / sy;
      if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 2) {
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
      const i = pick(e.offsetX, e.offsetY);
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
    const [wx, wy] = worldAt(px, py);
    view.zoom = Math.min(60, Math.max(0.4, view.zoom * factor));
    const [wx2, wy2] = worldAt(px, py);
    view.cx += wx - wx2;
    view.cy += wy - wy2;
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
