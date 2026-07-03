// main.ts — fetch stats.json, orchestrira render. Consumer graceful degradira:
// render samo sekcije koje postoje u JSON-u. NIKAD hardkodirane brojke.

import "./theme.css";
import type { Chart, StatsJson } from "./types.ts";
import { h } from "./dom.ts";
import { generatedLabel, shortDate } from "./format.ts";
import { renderTiles } from "./tiles.ts";
import { channelsChart } from "./charts/bar.ts";
import { leaderboardChart } from "./charts/leaderboard.ts";
import { timelineChart } from "./charts/area.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
const charts: Chart[] = [];

function brandMark(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("aria-hidden", "true");
  const stripes: [string, number][] = [["#ff0000", 0], ["#ffffff", 12], ["#002f6c", 24]];
  const clip = document.createElementNS(ns, "clipPath");
  clip.id = "bm";
  const cr = document.createElementNS(ns, "rect");
  cr.setAttribute("width", "36"); cr.setAttribute("height", "36"); cr.setAttribute("rx", "8");
  clip.appendChild(cr);
  svg.appendChild(clip);
  const g = document.createElementNS(ns, "g");
  g.setAttribute("clip-path", "url(#bm)");
  for (const [fill, y] of stripes) {
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", "0"); r.setAttribute("y", String(y));
    r.setAttribute("width", "36"); r.setAttribute("height", "12");
    r.setAttribute("fill", fill);
    g.appendChild(r);
  }
  const frame = document.createElementNS(ns, "rect");
  frame.setAttribute("x", "0.5"); frame.setAttribute("y", "0.5");
  frame.setAttribute("width", "35"); frame.setAttribute("height", "35");
  frame.setAttribute("rx", "7.5"); frame.setAttribute("fill", "none");
  frame.setAttribute("stroke", "rgba(0,0,0,0.12)");
  svg.append(g, frame);
  return svg;
}

function hero(data: StatsJson): HTMLElement {
  const wrap = h("header", { class: "hero" });

  const brand = h("div", { class: "brand" });
  brand.appendChild(brandMark());
  const word = h("span", {}, "DOMOVINA");
  word.appendChild(h("span", { class: "accent" }, ".ai"));
  brand.appendChild(word);

  const title = h("h1", {}, "DOMOVINA.ai u brojkama");
  const subText = data.source === "local"
    ? `${generatedLabel(data.generated_at)} · lokalni snapshot`
    : generatedLabel(data.generated_at);
  const sub = h("p", { class: "sub" }, subText);

  wrap.append(brand, title, sub);
  return wrap;
}

function card(titleTxt: string, subTxt: string, chart: Chart): HTMLElement {
  const c = h("section", { class: "card" });
  c.append(h("h2", {}, titleTxt), h("p", { class: "card-sub" }, subTxt));
  c.appendChild(chart.el);
  charts.push(chart);
  return c;
}

function footer(data: StatsJson): HTMLElement {
  const f = h("footer", { class: "foot" });
  const mcp = h("a", { href: "https://mcp.domovina.ai" }, "mcp.domovina.ai");
  f.append(
    h("span", {}, "Semantički korpus hrvatskih podcasta."),
    (() => { const s = h("span", {}); s.append("MCP pristup: ", mcp); return s; })(),
  );
  if (data.totals?.first_date && data.totals?.last_date) {
    f.appendChild(h("span", {},
      `Raspon: ${shortDate(data.totals.first_date)} – ${shortDate(data.totals.last_date)}`));
  }
  return f;
}

function render(data: StatsJson): void {
  app.replaceChildren();
  const wrap = h("div", { class: "wrap" });

  wrap.appendChild(hero(data));

  if (data.totals) wrap.appendChild(renderTiles(data.totals));

  if (data.channels?.length) {
    wrap.appendChild(card(
      "Kanali",
      "Epizode po kanalu — najzastupljeniji, ostatak agregiran u „Ostali”.",
      channelsChart(data.channels),
    ));
  }

  if (data.timeline?.length) {
    wrap.appendChild(card(
      "Korpus kroz vrijeme",
      "Nove epizode po mjesecu od početka korpusa.",
      timelineChart(data.timeline),
    ));
  }

  if (data.top_speakers?.length) {
    wrap.appendChild(card(
      "Najzastupljeniji govornici",
      "Po broju epizoda u kojima se pojavljuju (top 15).",
      leaderboardChart(data.top_speakers),
    ));
  }

  wrap.appendChild(footer(data));
  app.appendChild(wrap);
  layout();
}

function layout(): void {
  for (const c of charts) {
    const w = c.el.clientWidth || c.el.parentElement?.clientWidth || 640;
    c.draw(Math.round(w));
  }
}

let raf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(layout);
});

function renderError(msg: string): void {
  app.replaceChildren();
  const wrap = h("div", { class: "wrap" });
  wrap.append(
    hero({ generated_at: new Date().toISOString(), totals: null as never }),
    h("div", { class: "err" }, msg),
  );
  app.appendChild(wrap);
}

fetch("stats.json", { cache: "no-cache" })
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then((data: StatsJson) => {
    if (!data?.totals) throw new Error("neispravan stats.json (nema totals)");
    render(data);
  })
  .catch((e) => {
    console.error("[domovina-stats]", e);
    renderError("Statistike trenutno nisu dostupne. Pokušajte kasnije.");
  });
