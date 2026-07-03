# CLAUDE.md — domovina-stats

Javni **statistički dashboard** za DOMOVINA.ai korpus. Vizualizira stanje
semantičke baze hrvatskog podcast korpusa (epizode, chunkovi, kanali, govornici,
sati, rast kroz vrijeme). Live (planirano): `https://stats.domovina.ai`.

**Plan je već napisan — čitaj `docs/`, ne izmišljaj novi.** Ovaj CLAUDE.md samo
sažima i pokazuje; izvor istine su docs.

| Fajl | Sadržaj |
|---|---|
| `docs/00-plan.md` | Opseg v1, fiksirane odluke, faze, checklist |
| `docs/01-architecture.md` | Static-snapshot pattern, dataflow, zašto ne live DB |
| `docs/02-data-contract.md` | `stats.json` shape (jedini ugovor) + CH upiti (referenca) |
| `docs/03-frontend.md` | Vite + vanilla TS struktura, dataviz, popis grafova |
| `docs/04-deploy-and-cron.md` | CF Pages direct deploy, domena, cron wiring |

## Separation of concerns (🔴 ključno)

Ovaj repo je **čisti consumer** — čita jedan `stats.json` snapshot i crta grafove.
**Nikad ne gađa bazu.** Generator snapshota **i** cron žive u siblingu
`domovina-rag` (tamo je ClickHouse+PG pristup i dnevni launchd cron):

```
domovina-rag  (ima CH+PG, cron)              domovina-stats (ovaj repo)
  scripts/sync-stats.sh --cloud --deploy  →  public/stats.json  →  CF Pages
        (generira + deploya)                   (frontend crta)     stats.domovina.ai
```

Sibling repovi: `domovina-rag` = data backend, `fetch.domovina.tv` = producer.

**Ako se zatekneš da pišeš ClickHouse upit ili SSH deploy u OVOM repou — stani,
to ide u `domovina-rag`.** Ovdje se zna samo za `stats.json` shape, ništa o CH,
SSH ni credsima. Vidi `docs/01-architecture.md` (granice) i `docs/04` (cron).

## Stack

- **Vite + vanilla TS** (`npm create vite@latest . -- --template vanilla-ts`).
  Bez frameworka — landing s par grafova ne treba React.
- **Charts = inline SVG** (bez teške biblioteke) → puna kontrola nad dataviz sustavom.
- **Cloudflare Pages** statični hosting, bez backenda.

## Jezik

- Sav **user-facing tekst = hrvatski**, čist (bez srbizama — "osvježeno" ne
  "ažurirano"; "govornici", "epizode"). Tech termini (MCP, JSON) ostaju engleski.
- **Identifieri u kodu = engleski.**

## Dataviz — non-negotiables (🔴 pokreni `dataviz` skill PRIJE ijednog grafa/boje)

Redoslijed: **forma → boja po poslu → validiraj paletu skriptom → mark spec →
hover → a11y → pogledaj render.** Boja je ZADNJA. Vidi `docs/03-frontend.md`.

- **Jedna os.** Nikad dual-axis. Dvije mjere različite skale → dva grafa.
- **Kategorijske boje u fiksnom redoslijedu**, nikad cycled. 9. serija → "Ostali".
- Boja prati **entitet, ne rang** (filter ne smije reobojati preživjele).
- Sekvencijalno = jedna nijansa svijetlo→tamno, bez duge.
- **Validiraj paletu prije shipa:** `node scripts/validate_palette.js "<hex,…>" --mode light` pa `--mode dark`. Ne eyeball-aj ΔE.
- **Legenda** uvijek za ≥2 serije; tanke marke; recesivni grid/os; tekst nosi
  text-tokene, ne boju serije.
- **Hover layer po defaultu** (crosshair+tooltip na line/area, per-mark na bar).
- **Dark mode je biran** (vlastiti validirani koraci), ne automatski flip.

## Brand

Croatian tricolour na bijeloj podlozi (canonical: `sms.domovina.ai/webhook/src/views.ts`).
Ne izmišljaj hexeve — povuci odande, pa snapaj na najbliži prolazeći dataviz korak.

- `--red: #FF0000` · `--white: #FFFFFF` · `--navy: #002F6C` (primarni brand)
- `--muted: #5A6570` · `--border: #E1E5EA` · `--surface: #F5F7F9` · `--bg: #FFFFFF`
- navy hover `#001D4A`; wordmark **DOMOVINA**`.ai` (`.ai` crveni)
- font: `system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`; mono `ui-monospace, "SF Mono", Menlo, …`

Vidi memory `reference_domovina_brand_pattern`.

## Podaci

- **NIKAD ne hardkodiraj brojke** — uvijek iz `stats.json`. Red veličine
  (2026-07-03): ~3008 epizoda, ~136k chunkova, 44 kanala, ~2850 sati, 2016–2026.
- Consumer mora **graceful degradirati**: render samo sekcije koje postoje u JSON-u
  (npr. `top_speakers` može nedostajati). Shape: `docs/02-data-contract.md`.

## Deploy

Direktni `wrangler pages deploy` (NE git-build; izbjegava dnevni data-commit šum):

```bash
npm run build
npx wrangler pages deploy dist --project-name=domovina-stats
```

Domena `stats.domovina.ai` (CF custom domain). Cron deploy pokreće `domovina-rag`
(`sync-stats.sh --deploy`), ne ovaj repo. Detalji: `docs/04-deploy-and-cron.md`.

## Opseg v1 (odlučeno)

Samo **brojčani dashboard**. Vector map (2D UMAP point-cloud) je **Razina 2**,
zaseban rad kasnije — NE u v1. Vidi `docs/00-plan.md`.
