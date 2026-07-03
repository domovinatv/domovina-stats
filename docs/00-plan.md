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

## Razina 2 (kasnije, NIJE u v1) — vector map

2D UMAP projekcija 121K+ chunk embeddinga (1024-d → 2D), renderano kao WebGL
point-cloud (deck.gl `ScatterplotLayer`). Težak dio je **offline** (umap-learn na
Macu, ~min, output ~2–5 MB `.bin`), render je client-side. Nula nove
infrastrukture — samo još jedan cron korak. Ne raditi dok v1 nije live.

## Checklist

- [ ] `sync-stats.sh` + `emit_stats_json.py` u domovina-rag
- [ ] `stats.json` shape verificiran (vidi `02-data-contract.md`)
- [ ] Vite scaffold + brand
- [ ] Stat tiles + grafovi (validirana paleta, dark mode, hover, legenda)
- [ ] CF Pages projekt + `stats.domovina.ai`
- [ ] CF API token u `.env`; `--deploy` radi iz CLI-a
- [ ] Cron korak u `sync-cron.sh`
- [ ] E2E: cron generira → deploya → live snapshot svjež
