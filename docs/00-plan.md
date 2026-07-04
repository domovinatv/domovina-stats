# 00 — Master plan

## Cilj

Javni landing na `stats.domovina.ai` koji vizualizira stanje DOMOVINA.ai korpusa:
koliko epizoda, chunkova, kanala, govornika, sati transkribiranog audija, kako
korpus raste kroz vrijeme, i tko su najzastupljeniji govornici. Uzor po ambiciji:
Magisterium AI (`magisterium.com/about/vector-map`) — ali v1 je **brojčani
dashboard**, ne vector map.

## Odluke (fiksirane)

| Odluka | Vrijednost | Razlog |
|---|---|---|
| Opseg v1 | Samo brojčani dashboard | Vector map (Razina 2) dolazi zasebno |
| Domena | `stats.domovina.ai` | — |
| Deploy | Direktni `wrangler pages deploy` iz crona | Izbjegava git-noise od dnevnih data-commitova |
| Hosting | Cloudflare Pages (statika) | Besplatno, bez backenda, bez izložene baze |
| Frontend stack | Vite + vanilla TS | Najlakši statični build; landing ne treba framework |
| Charts | Inline SVG (bez teške biblioteke) | v1 ima malo grafova; puna kontrola nad dataviz sustavom |
| Izvor podataka | ClickHouse `rag_chunks` (cloud) | Ono što se stvarno poslužuje javno |
| Refresh | Dnevni cron u `domovina-rag` (uz postojeći 04:00 sync) | Snapshot je derivat CH-a |

## Zašto je generator u `domovina-rag`, a ne ovdje

Isti separation-of-concerns kao producer/consumer:

- **`domovina-rag`** ima ClickHouse+PG pristup i dnevni launchd cron. Tamo živi
  `scripts/sync-stats.sh` koji generira `stats.json` i deploya.
- **`domovina-stats`** (ovaj repo) je čisti consumer — samo `stats.json` +
  frontend koji ga crta.

**🔴 PRAVILO (iz domovina-rag CLAUDE.md):** svaka nova tablica/artefakt izveden
iz ClickHouse-a MORA dobiti korak u `domovina-rag/scripts/sync-cron.sh` (lokalni
+ `--cloud`), inače cloud tiho zaostaje. `stats.json` je takav artefakt → dobiva
`sync-stats.sh --cloud --deploy` korak. Vidi `04-deploy-and-cron.md`.

## Faze

### Faza A — snapshot generator (u domovina-rag)
1. `scripts/sync-stats.sh` — CH upiti (local ili `--cloud` preko SSH-a), sklopi
   `stats.json`, zapiši u `../domovina-stats/public/stats.json`.
2. `scripts/emit_stats_json.py` — stdlib transformer CH TSV/JSON → `stats.json`
   (isti dependency-free pattern kao `emit_speakers_sql.py`).
3. `--deploy` flag: `cd ../domovina-stats && npm run build && wrangler pages deploy`.

### Faza B — frontend (ovaj repo)
1. `npm create vite@latest . -- --template vanilla-ts`.
2. Brand (boje/font/logo) iz `reference_domovina_brand_pattern` (canonical:
   `sms.domovina.ai/webhook/src/views.ts`).
3. Stat tiles (hero brojke) + grafovi (vidi `03-frontend.md`).
4. Dark mode + hover + legenda + validirana paleta (`dataviz` skill).

### Faza C — deploy + domena
1. CF Pages projekt `domovina-stats` (direct upload).
2. Custom domena `stats.domovina.ai` (CNAME u CF dashboardu).
3. CF API token (Pages:Edit) u `domovina-rag/.env` za cron deploy.

### Faza D — cron wiring (u domovina-rag)
1. Dodaj korak u `sync-cron.sh` poslije Meili/speakers refresh-a.
2. Verificiraj: dan poslije, `stats.domovina.ai` pokazuje svjež `generated_at`.

## Razina 2 — vector map (IMPLEMENTIRANO 2026-07-04; 3D + teme 2026-07-05)

UMAP projekcija svih chunk embeddinga na `/map`, **2D (default) + 3D toggle**.
Umjesto deck.gl-a iz prvotne skice: **custom WebGL2 point-cloud bez ovisnosti**
(`src/map.ts` — gl.POINTS, dva programa/VAO-a; 2D: pan/zoom/pinch +
spatial-grid hover picking; 3D: auto/drag rotacija + brute-force projekcijski
picking, dubinski fade; klik → domovina.ai player `/v/{id}/t/{sec}` — miš
direktno, dodir preko snackbara; filter po kanalu). **Imenovani klasteri tema**
(industrijski standard za razumijevanje semantičke blizine, à la Nomic
Atlas/datamapplot): HDBSCAN(leaf) na 2D layoutu + LLM imena, kao zoom-ovisan
HTML overlay s greedy anti-overlapom. Težak dio je offline (umap-learn u
`domovina-rag/.venv-vectormap`, 2×UMAP ~4 min na M4, preskače se ako nema
novih chunkova). Contract: `02-data-contract.md` § Vector map. Cron korak 7a
u `domovina-rag/scripts/sync-cron.sh`; deploya ga postojeći korak 7.

⚠️ LLM imenovanje: Vertex na `domovina-sync-ms` je BILLING_DISABLED, a gemini
CLI deprecated (IneligibleTierError) — inicijalne labele su ručno kurirane
(Claude, 2026-07-05), a cron ih **nasljeđuje** preko `eps` otiska klastera dok
se billing ne vrati.

## Checklist

- [ ] `sync-stats.sh` + `emit_stats_json.py` u domovina-rag
- [ ] `stats.json` shape verificiran (vidi `02-data-contract.md`)
- [ ] Vite scaffold + brand
- [ ] Stat tiles + grafovi (validirana paleta, dark mode, hover, legenda)
- [ ] CF Pages projekt + `stats.domovina.ai`
- [ ] CF API token u `.env`; `--deploy` radi iz CLI-a
- [ ] Cron korak u `sync-cron.sh`
- [ ] E2E: cron generira → deploya → live snapshot svjež
