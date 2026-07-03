// area.ts — korpus kroz vrijeme (epizode po mjesecu). Jedna serija, jedna os.
// Area wash ~10% + 2px linija. Crosshair snapa na najbliži mjesec (čitatelj cilja
// datum, ne 2px liniju), tooltip nosi vrijednost. Time-based X (rupe se vide).

import type { Chart, TimelinePoint } from "../types.ts";
import { svgEl, h, showTooltip, hideTooltip } from "../dom.ts";
import { num, monthLabel } from "../format.ts";

const H = 260;
const M = { top: 14, right: 14, bottom: 26, left: 44 };

function tMs(monthISO: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(monthISO);
  return m ? Date.UTC(+m[1], +m[2] - 1, 1) : NaN;
}

/** Zaokruži max na čist korak i vrati tickove [0..niceMax]. */
function niceTicks(max: number, target = 4): { ticks: number[]; niceMax: number } {
  if (max <= 0) return { ticks: [0], niceMax: 1 };
  const raw = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(Math.round(v));
  return { ticks, niceMax };
}

export function timelineChart(points: TimelinePoint[]): Chart {
  const el = h("div");
  const pts = [...points]
    .filter((p) => !isNaN(tMs(p.month)))
    .sort((a, b) => tMs(a.month) - tMs(b.month));

  const maxVal = Math.max(1, ...pts.map((p) => p.episodes));
  const { ticks, niceMax } = niceTicks(maxVal);
  const t0 = pts.length ? tMs(pts[0].month) : 0;
  const t1 = pts.length ? tMs(pts[pts.length - 1].month) : 1;
  const tSpan = Math.max(1, t1 - t0);

  function draw(width: number): void {
    el.replaceChildren();
    const plotW = Math.max(20, width - M.left - M.right);
    const plotH = H - M.top - M.bottom;
    const x0 = M.left;
    const yBase = M.top + plotH;

    const xOf = (ms: number) => x0 + ((ms - t0) / tSpan) * plotW;
    const yOf = (v: number) => M.top + plotH - (v / niceMax) * plotH;

    const svg = svgEl("svg", {
      width, height: H, viewBox: `0 0 ${width} ${H}`,
      role: "img", "aria-label": "Rast korpusa kroz vrijeme (epizode po mjesecu)",
    });

    // ── y grid + tick labele (recesivno) ──
    for (const tv of ticks) {
      const y = yOf(tv);
      svg.appendChild(svgEl("line", {
        x1: x0, y1: y, x2: x0 + plotW, y2: y,
        class: tv === 0 ? "axis-line" : "grid-line",
      }));
      const lbl = svgEl("text", {
        x: x0 - 8, y, "text-anchor": "end", "dominant-baseline": "middle",
        class: "axis-tick tick-num",
      });
      lbl.textContent = num(tv);
      svg.appendChild(lbl);
    }

    // ── x godišnji tickovi ──
    const y0 = +new Date(t0).getUTCFullYear();
    const y1 = +new Date(t1).getUTCFullYear();
    const yearsSpan = y1 - y0;
    const stepY = yearsSpan > 8 && plotW < 560 ? 2 : 1;
    for (let yr = y0; yr <= y1; yr += stepY) {
      const ms = Date.UTC(yr, 0, 1);
      if (ms < t0 - 1 || ms > t1 + 1) continue;
      const x = xOf(ms);
      const t = svgEl("text", {
        x, y: H - 8, "text-anchor": "middle", class: "axis-tick tick-num",
      });
      t.textContent = String(yr);
      svg.appendChild(t);
    }

    // ── area + linija ──
    if (pts.length) {
      const lineD = pts.map((p, i) =>
        `${i ? "L" : "M"}${xOf(tMs(p.month)).toFixed(1)},${yOf(p.episodes).toFixed(1)}`
      ).join("");
      const areaD =
        `M${xOf(tMs(pts[0].month)).toFixed(1)},${yBase.toFixed(1)}` +
        pts.map((p) => `L${xOf(tMs(p.month)).toFixed(1)},${yOf(p.episodes).toFixed(1)}`).join("") +
        `L${xOf(tMs(pts[pts.length - 1].month)).toFixed(1)},${yBase.toFixed(1)}Z`;

      svg.appendChild(svgEl("path", { d: areaD, class: "area-fill" }));
      svg.appendChild(svgEl("path", { d: lineD, class: "area-line" }));
    }

    // ── crosshair + hover layer ──
    const cross = svgEl("line", { class: "crosshair", y1: M.top, y2: yBase, x1: -99, x2: -99, opacity: "0" });
    const dotRing = svgEl("circle", { r: 5.5, class: "area-dot-ring", opacity: "0" });
    const dot = svgEl("circle", { r: 3.5, class: "area-dot", opacity: "0" });
    svg.append(cross, dotRing, dot);

    const hit = svgEl("rect", {
      x: x0, y: M.top, width: plotW, height: plotH, fill: "transparent",
    });
    svg.appendChild(hit);

    const xs = pts.map((p) => xOf(tMs(p.month)));
    function onMove(e: PointerEvent): void {
      if (!pts.length) return;
      const rect = svg.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (width / rect.width);
      // najbliži mjesec po x
      let bi = 0, bd = Infinity;
      for (let i = 0; i < xs.length; i++) {
        const d = Math.abs(xs[i] - sx);
        if (d < bd) { bd = d; bi = i; }
      }
      const p = pts[bi];
      const px = xs[bi];
      const py = yOf(p.episodes);
      cross.setAttribute("x1", String(px));
      cross.setAttribute("x2", String(px));
      cross.setAttribute("opacity", "1");
      for (const c of [dotRing, dot]) {
        c.setAttribute("cx", String(px));
        c.setAttribute("cy", String(py));
        c.setAttribute("opacity", "1");
      }
      showTooltip(e.clientX, e.clientY, monthLabel(p.month), num(p.episodes), "epizoda", [
        { label: "odlomci", value: num(p.chunks) },
      ]);
    }
    function onLeave(): void {
      cross.setAttribute("opacity", "0");
      dotRing.setAttribute("opacity", "0");
      dot.setAttribute("opacity", "0");
      hideTooltip();
    }
    hit.addEventListener("pointermove", onMove as EventListener);
    hit.addEventListener("pointerleave", onLeave);

    el.appendChild(svg);
  }

  return { el, draw };
}
