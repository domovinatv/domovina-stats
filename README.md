# domovina-stats

Javni **statistički dashboard** za DOMOVINA.ai korpus — vizualizira stanje
semantičke baze (ClickHouse + PostgreSQL) hrvatskog podcast korpusa.

**Live (planirano):** `https://stats.domovina.ai`

## Što je ovo (i što NIJE)

Ovo je **statični frontend** koji čita jedan `stats.json` snapshot i crta grafove.
Ne priča s bazom u realnom vremenu — snapshot generira dnevni cron na Macu (gdje
je pristup ClickHouse-u) i deploya se direktno na Cloudflare Pages.

```
domovina-rag (cron, ima CH+PG pristup)          domovina-stats (ovaj repo)
   scripts/sync-stats.sh  --cloud  --deploy   →   public/stats.json  →  CF Pages
        (generira snapshot)                        (frontend crta)      stats.domovina.ai
```

- **Consumer:** ovaj repo samo konzumira `stats.json`. Nikad ne gađa bazu.
- **Producer snapshota:** `domovina-rag/scripts/sync-stats.sh` (živi TAMO jer je
  tamo CH pristup i dnevni cron). Vidi `docs/02-data-contract.md`.

## Plan

Cijeli plan je u `docs/`:

| Fajl | Sadržaj |
|---|---|
| `docs/00-plan.md` | Master plan, opseg v1, odluke, faze, checklist |
| `docs/01-architecture.md` | Static-snapshot pattern, dataflow dijagram, zašto ne live DB |
| `docs/02-data-contract.md` | `stats.json` shape + točni ClickHouse upiti koji ga pune |
| `docs/03-frontend.md` | Vite + vanilla TS struktura, dataviz sustav, popis grafova |
| `docs/04-deploy-and-cron.md` | CF Pages direct deploy, domena, wiring u sync-cron.sh |

## Opseg v1 (odlučeno)

- **Samo brojčani dashboard** (bez vector mapa — to je Razina 2, kasnije).
- Domena: **stats.domovina.ai**
- Deploy: **direktni** `wrangler pages deploy` iz crona (ne git-build).

## Quick start (za implementaciju)

```bash
npm create vite@latest . -- --template vanilla-ts
npm install
npm run dev        # lokalni preview protiv public/stats.json
npm run build      # → dist/
npx wrangler pages deploy dist --project-name=domovina-stats
```
