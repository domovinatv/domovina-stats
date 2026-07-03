// dom.ts — sitni DOM/SVG helperi + shared tooltip. Bez ovisnosti.

const SVGNS = "http://www.w3.org/2000/svg";

/** SVG element s atributima. */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** HTML element; text ide preko textContent (labele su untrusted data). */
export function h(
  tag: string,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  if (text != null) el.textContent = text;
  return el;
}

// ── shared tooltip ──────────────────────────────────────────────────────────
let ttNode: HTMLDivElement | null = null;

function ttEnsure(): HTMLDivElement {
  if (!ttNode) {
    ttNode = document.createElement("div");
    ttNode.className = "tt";
    ttNode.setAttribute("role", "status");
    document.body.appendChild(ttNode);
  }
  return ttNode;
}

export interface TooltipRow { label: string; value: string; }

/** Prikaži tooltip kraj (clientX,clientY). Naslov + istaknuta vrijednost + retci.
 *  Sve preko textContent — nikad innerHTML s untrusted labelama. */
export function showTooltip(
  x: number, y: number,
  cat: string, value: string, unit: string,
  rows: TooltipRow[] = [],
): void {
  const tt = ttEnsure();
  tt.replaceChildren();

  const catEl = h("div", { class: "tt-cat" }, cat);
  const valEl = h("div", { class: "tt-val" }, value);
  if (unit) valEl.appendChild(h("span", { class: "u" }, ` ${unit}`));
  tt.append(catEl, valEl);

  for (const r of rows) {
    const row = h("div", { class: "tt-row" }, `${r.label}: `);
    row.appendChild(h("b", {}, r.value));
    tt.appendChild(row);
  }

  // pozicioniraj: desno-gore od pointera, flip ako izlazi iz viewporta
  tt.classList.add("on");
  const rect = tt.getBoundingClientRect();
  let px = x + 14;
  let py = y - rect.height - 12;
  if (px + rect.width > window.innerWidth - 8) px = x - rect.width - 14;
  if (py < 8) py = y + 16;
  tt.style.left = `${Math.max(8, px)}px`;
  tt.style.top = `${py}px`;
}

export function hideTooltip(): void {
  if (ttNode) ttNode.classList.remove("on");
}
