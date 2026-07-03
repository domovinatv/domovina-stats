// tiles.ts — hero stat tiles. Nije graf: velika brojka + labela (+ jedinica).
// Vrijednosti iz totals; NIKAD hardkodirano.

import type { StatsTotals } from "./types.ts";
import { num, year } from "./format.ts";
import { h } from "./dom.ts";

interface TileDef {
  value: string;
  unit?: string;
  label: string;
}

export function renderTiles(totals: StatsTotals): HTMLElement {
  const rangeSpan = `${year(totals.first_date)}–${year(totals.last_date)}`;

  const defs: TileDef[] = [
    { value: num(totals.episodes), label: "epizoda" },
    { value: num(totals.chunks), label: "semantičkih odlomaka" },
    { value: num(totals.channels), label: "kanala" },
    { value: num(totals.hours), unit: "h", label: "sati transkribiranog audija" },
    { value: num(totals.speakers), label: "imenovanih govornika" },
    { value: rangeSpan, label: "raspon korpusa" },
  ];

  const grid = h("div", { class: "tiles" });
  for (const d of defs) {
    const tile = h("div", { class: "tile" });
    const val = h("div", { class: "value" }, d.value);
    if (d.unit) val.appendChild(h("span", { class: "unit" }, d.unit));
    tile.append(val, h("div", { class: "label" }, d.label));
    grid.appendChild(tile);
  }
  return grid;
}
