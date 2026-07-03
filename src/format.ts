// format.ts — hrvatsko formatiranje brojeva i datuma. Sve user-facing.

const nf = new Intl.NumberFormat("hr-HR");

/** 136513 → "136.513" */
export function num(n: number): string {
  return nf.format(Math.round(n));
}

/** Kompaktno za velike brojke po dataviz contractu (1.284 / 12,9 tis. / …). */
export function compact(n: number): string {
  if (n < 10_000) return num(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${nf.format(Math.round(k * 10) / 10)} tis.`;
  }
  const m = n / 1_000_000;
  return `${nf.format(Math.round(m * 10) / 10)} mil.`;
}

/** "2016-02-18" → "18.02.2016." */
export function shortDate(iso: string): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()}.`;
}

/** "2016-02-18" → "2016." (samo godina) */
export function year(iso: string): string {
  return iso.slice(0, 4);
}

const monthNames = [
  "siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja",
  "srpnja", "kolovoza", "rujna", "listopada", "studenoga", "prosinca",
];

/** "2016-02-01" → "veljača 2016." (za tooltip mjeseca) */
export function monthLabel(iso: string): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  // nominativ za standalone label
  const nom = [
    "siječanj", "veljača", "ožujak", "travanj", "svibanj", "lipanj",
    "srpanj", "kolovoz", "rujan", "listopad", "studeni", "prosinac",
  ];
  return `${nom[d.getUTCMonth()]} ${d.getUTCFullYear()}.`;
}

/** ISO UTC timestamp → "osvježeno 3. srpnja 2026. u 09:42 UTC" */
export function generatedLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = d.getUTCDate();
  const mon = monthNames[d.getUTCMonth()];
  const yr = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `osvježeno ${day}. ${mon} ${yr}. u ${hh}:${mi} UTC`;
}

function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
