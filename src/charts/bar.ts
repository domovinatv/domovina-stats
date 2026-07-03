// bar.ts — horizontalni bar chart (magnitude po kategoriji).
// Jedna serija, jedna nijansa (boja prati entitet, ne rang). Value na vrhu marke,
// per-mark hover. Agregat ("Ostali") nosi muted boju. Rerenderira se na širinu.

import type { Chart, ChannelRow } from "../types.ts";
import type { TooltipRow } from "../dom.ts";
import { svgEl, h, showTooltip, hideTooltip } from "../dom.ts";
import { num } from "../format.ts";

export interface HBarRow {
  cat: string;
  value: number;
  aggregate?: boolean;
  tip: TooltipRow[]; // dodatni retci u tooltipu
}

const ROW_H = 32;
const BAR_THICK = 20; // ≤24px
const PAD_T = 6;
const PAD_B = 6;
const CHAR_W = 6.6; // aproks. za ellipsize labele

/** Right-rounded pravokutnik: rounded data-end (desno), square na baseline (lijevo). */
function barPath(x: number, y: number, w: number, hgt: number, r = 4): string {
  if (w <= r) return `M${x},${y}h${Math.max(w, 0.5)}v${hgt}h${-Math.max(w, 0.5)}z`;
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${hgt - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`;
}

function ellipsize(s: string, maxPx: number): string {
  const max = Math.max(3, Math.floor(maxPx / CHAR_W));
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/** Generički horizontalni bar chart. Dijele ga kanali i leaderboard. */
export function hbarChart(rows: HBarRow[], unitWord: string): Chart {
  const el = h("div");
  const maxVal = Math.max(1, ...rows.map((r) => r.value));

  function draw(width: number): void {
    el.replaceChildren();
    const labelW = Math.min(180, Math.max(96, Math.round(width * 0.32)));
    const valueW = 52;
    const barX = labelW + 8;
    const barMaxW = Math.max(20, width - barX - valueW);
    const height = PAD_T + rows.length * ROW_H + PAD_B;

    const svg = svgEl("svg", {
      width, height, viewBox: `0 0 ${width} ${height}`,
      role: "img", "aria-label": `Bar chart: ${unitWord} po kategoriji`,
    });

    rows.forEach((r, i) => {
      const y = PAD_T + i * ROW_H;
      const cy = y + ROW_H / 2;
      const barY = cy - BAR_THICK / 2;
      const w = Math.max(2, (r.value / maxVal) * barMaxW);

      const g = svgEl("g", { class: "bar-row", tabindex: "0" });

      // transparentni hit-target preko cijelog reda
      const hit = svgEl("rect", { x: 0, y, width, height: ROW_H, fill: "transparent" });
      g.appendChild(hit);

      // kategorija (lijevo, text token, ne boja serije)
      const cat = svgEl("text", {
        x: labelW, y: cy, "text-anchor": "end", "dominant-baseline": "middle",
        class: "bar-cat",
      });
      cat.textContent = ellipsize(r.cat, labelW - 6);
      g.appendChild(cat);

      // marka
      const bar = svgEl("path", {
        d: barPath(barX, barY, w, BAR_THICK),
        class: r.aggregate ? "bar-mark aggregate" : "bar-mark",
      });
      g.appendChild(bar);

      // value na vrhu marke
      const val = svgEl("text", {
        x: barX + w + 6, y: cy, "dominant-baseline": "middle", class: "bar-val",
      });
      val.textContent = num(r.value);
      g.appendChild(val);

      // hover / focus tooltip
      const show = (cx: number, cyp: number) =>
        showTooltip(cx, cyp, r.cat, num(r.value), unitWord, r.tip);
      g.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
      g.addEventListener("pointerleave", hideTooltip);
      g.addEventListener("focus", () => {
        const b = bar.getBoundingClientRect();
        show(b.right, b.top);
      });
      g.addEventListener("blur", hideTooltip);

      svg.appendChild(g);
    });

    el.appendChild(svg);
  }

  return { el, draw };
}

// ── kanali ────────────────────────────────────────────────────────────────
const TOP_CHANNELS = 12;

function prettyChannel(slug: string): string {
  return slug.replace(/_/g, " ");
}

export function channelsChart(channels: ChannelRow[]): Chart {
  const sorted = [...channels].sort((a, b) => b.episodes - a.episodes);
  const top = sorted.slice(0, TOP_CHANNELS);
  const rest = sorted.slice(TOP_CHANNELS);

  const rows: HBarRow[] = top.map((c) => ({
    cat: prettyChannel(c.channel),
    value: c.episodes,
    tip: [
      { label: "odlomci", value: num(c.chunks) },
      { label: "sati", value: num(c.hours) },
    ],
  }));

  if (rest.length) {
    const agg = rest.reduce(
      (a, c) => ({
        episodes: a.episodes + c.episodes,
        chunks: a.chunks + c.chunks,
        hours: a.hours + c.hours,
      }),
      { episodes: 0, chunks: 0, hours: 0 },
    );
    rows.push({
      cat: `Ostali (${rest.length})`,
      value: agg.episodes,
      aggregate: true,
      tip: [
        { label: "kanala", value: num(rest.length) },
        { label: "odlomci", value: num(agg.chunks) },
        { label: "sati", value: num(agg.hours) },
      ],
    });
  }

  return hbarChart(rows, "epizoda");
}
