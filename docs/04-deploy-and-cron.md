# 04 — Deploy + cron

## Cloudflare Pages (direct upload)

Deploy je **direktni** (`wrangler pages deploy`), NE git-build. Razlog: snapshot
se mijenja dnevno; git-build bi značio dnevni data-commit (šum). Direct upload
dedupira nepromijenjene fajlove hashom, pa je dnevni re-deploy jeftin (uploada se
samo promijenjeni `stats.json`).

```bash
# jednokratni setup projekta (prvi put)
npx wrangler pages project create domovina-stats --production-branch main

# svaki deploy
npm run build
npx wrangler pages deploy dist --project-name=domovina-stats
```

### Custom domena `stats.domovina.ai`

U CF dashboardu: Pages → domovina-stats → Custom domains → dodaj
`stats.domovina.ai`. DNS je na Cloudflareu (zona `domovina.ai`) → CNAME se doda
automatski. (Usp. `lessons_cf_pages_redirects_html` ako ikad dodaješ `_redirects`.)

### CF API token (za cron deploy)

Cron treba token da deploya bez interaktivnog logina:
- CF dashboard → My Profile → API Tokens → Create → **Cloudflare Pages: Edit**.
- Spremi u `domovina-rag/.env`: `CLOUDFLARE_API_TOKEN=…` (+ već postoji
  `CLOUDFLARE_ACCOUNT_ID`).
- `wrangler` ih čita iz env-a (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).

## Generator + cron (živi u domovina-rag)

### `scripts/sync-stats.sh` (novi, uzor: `sync-speakers.sh`)

Skica:
```bash
# 1. Konekcija na CH (local ili --cloud preko SSH-a; discover container).
# 2. Pokreni 5 upita iz docs/02-data-contract.md (FORMAT JSON).
# 3. emit_stats_json.py sklopi u jedan stats.json (stdlib, bez ovisnosti).
# 4. Zapiši u ${STATS_REPO_DIR:-../domovina-stats}/public/stats.json.
# 5. Ako --deploy: cd $STATS_REPO_DIR && npm run build && \
#      npx wrangler pages deploy dist --project-name=domovina-stats
```

`generated_at` = `date -u +%Y-%m-%dT%H:%M:%SZ`. `source` = "cloud" za `--cloud`.

### Cron korak u `scripts/sync-cron.sh`

Dodaj POSLIJE Meili/speakers refresh-a (snapshot mora vidjeti svjež CH):
```bash
# ─── 7. Osvježi javni stats dashboard (derivat CH-a) ───
if [ "$RC" -eq 0 ]; then
  echo "[cron] Generiram + deployam stats dashboard (cloud)..."
  ./scripts/sync-stats.sh --cloud --deploy \
    || echo "[cron] WARN: stats sync/deploy pao (nastavljam)."
fi
```

**🔴 Ovo je obavezni korak** — `stats.json` je CH-derivat kao Meili i speakers;
bez cron koraka javni dashboard tiho zaostaje (vidi domovina-rag CLAUDE.md pravilo
i `feedback_new_derived_table_needs_cron`).

## Verifikacija (E2E)

1. Ručno: `./scripts/sync-stats.sh --cloud --deploy` → provjeri da
   `stats.domovina.ai` ima svjež `generated_at`.
2. Dan poslije: cron log (`.ingest-logs/sync-cron-YYYYMMDD.log`) pokazuje korak 7
   bez WARN-a; brojke na siteu = brojke iz cloud CH-a.
