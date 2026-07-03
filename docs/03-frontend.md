# 03 — Frontend

## Stack

Vite + vanilla TS (`npm create vite@latest . -- --template vanilla-ts`). Bez
frameworka — landing s par grafova ne treba React. Charts = **inline SVG**
(bez teške biblioteke) da imamo punu kontrolu nad dataviz sustavom.

## Struktura

```
domovina-stats/
  index.html
  public/
    stats.json          ← placeholder (dev); cron ga prepisuje pravim
  src/
    main.ts             ← fetch stats.json, orchestrira render
    types.ts            ← StatsJson tipovi (mirror data contract-a)
    tiles.ts            ← hero stat tiles
    charts/
      bar.ts            ← horizontalni bar (epizode/chunkovi po kanalu)
      area.ts           ← timeline (korpus kroz vrijeme)
      leaderboard.ts    ← top govornici
    palette.ts          ← validirana kategorijska/sekvencijalna paleta
    theme.css           ← brand + light/dark tokeni
  wrangler.toml         ← opcionalno (pages projekt config)
```

## Sekcije stranice

1. **Hero** — naslov "DOMOVINA.ai u brojkama" + `generated_at` ("osvježeno …").
2. **Stat tiles** — velike brojke: epizode, chunkovi, kanali, sati, govornici,
   raspon (first→last). Vidi `dataviz` — hero number NIJE graf, samo brojka +
   labela + jedinica.
3. **Kanali** — horizontalni bar chart (epizode po kanalu, top N + "Ostali").
4. **Korpus kroz vrijeme** — area/line (epizode ili chunkovi po mjesecu).
5. **Top govornici** — leaderboard (bar ili tablica), po epizodama.
6. **Footer** — link na MCP (`mcp.domovina.ai`), izvor podataka, licenca.

## dataviz — obavezno (skill `dataviz`)

Prije pisanja chart koda pokreni `dataviz` skill i slijedi proceduru. Ključno:

- **Redoslijed:** forma → boja po poslu → **validiraj paletu skriptom** → mark
  spec → hover → a11y → pogledaj render. Boja je ZADNJA.
- **Non-negotiables:**
  - Kategorijske boje u **fiksnom redoslijedu**, nikad cycled. 9. serija → "Ostali".
  - **Jedna os.** Nikad dual-axis. Dvije mjere različite skale → dva grafa.
  - Boja prati **entitet**, ne rang (filter ne smije reobojati preživjele).
  - Sekvencijalno = jedna nijansa svijetlo→tamno. Bez duge.
  - **Validiraj paletu** prije shipa: `node scripts/validate_palette.js "<hex,…>" --mode light` (pa `--mode dark`). Ne eyeball-aj ΔE.
  - Legenda uvijek za ≥2 serije (za 1 seriju nema — naslov je imenuje); tanke
    marke; recesivni grid/os; tekst nosi text-tokene, ne boju serije.
  - **Hover layer po defaultu** (crosshair+tooltip na line/area, per-mark na bar).
  - **Dark mode je biran** (vlastiti koraci iz istih ramp-i, validiran protiv
    dark surface), ne automatski flip.

## Brand

Boje/tipografija/logo iz `reference_domovina_brand_pattern` (memory u
domovina-rag). Canonical implementacija: `sms.domovina.ai/webhook/src/views.ts`.
Povuci brand nijanse ODANDE, pa ih feedaj u `dataviz` validator (snap na najbliži
prolazeći korak). Ne izmišljaj hexeve.

## Jezik

Sav user-facing tekst = **hrvatski**, čist (bez srbizama — "osvježeno", ne
"ažurirano" ako brand tako ne govori; "govornici", "epizode"). Tech termini (MCP,
JSON) ostaju engleski. Identifieri u kodu = engleski.

## Dev workflow

```bash
npm run dev     # Vite dev server, čita public/stats.json
# uredi stats.json ručno za brze iteracije rasporeda
npm run build   # → dist/
```
