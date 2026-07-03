Ti si Claude Code agent u repou `domovina-stats` — javni statistički dashboard za
DOMOVINA.ai korpus (dio šireg sustava; sibling repovi su `domovina-rag` = data
backend, i `fetch.domovina.tv` = producer).

## Prvo pročitaj (plan je već napisan)

Pročitaj ove fajlove tim redom — oni SU plan, ne izmišljaj novi:
- README.md
- docs/00-plan.md   (opseg v1, odluke, faze, checklist)
- docs/01-architecture.md   (static-snapshot pattern, dataflow)
- docs/02-data-contract.md   (stats.json shape + ClickHouse upiti)
- docs/03-frontend.md   (Vite+vanilla TS, dataviz sustav, grafovi)
- docs/04-deploy-and-cron.md   (CF Pages deploy, stats.domovina.ai, cron)

Ključne fiksirane odluke: v1 = SAMO brojčani dashboard (bez vector mapa),
domena stats.domovina.ai, direktni wrangler deploy, Vite+vanilla TS, inline SVG,
izvor je cloud ClickHouse rag_chunks. Generator snapshota + cron ŽIVE u
domovina-rag, NE ovdje — ovaj repo je čisti consumer stats.json-a.

## Zadatak ove sesije (tim redom)

1. Napravi CLAUDE.md za ovaj repo: što je repo, separation-of-concerns (consumer
   stats.json; generator/cron su u domovina-rag), stack (Vite+vanilla TS, inline
   SVG), jezik (sav user-facing tekst hrvatski, identifieri engleski), dataviz
   non-negotiables (jedna os, fiksni redoslijed kategorijskih boja, validirana
   paleta, dark mode biran, hover, legenda), deploy (direct wrangler pages
   deploy na stats.domovina.ai). Referenciraj docs/ umjesto da dupliciraš.

2. Generiraj memory fajlove po memory sustavu (frontmatter name/description/
   metadata.type + jednoredni pointer u MEMORY.md). Barem: (a) project — što je
   ovaj repo i granice, (b) reference — data contract stats.json shape (sažetak +
   pokazivač na docs/02), (c) reference — domovina brand pattern (boje/font/logo
   iz sms.domovina.ai/webhook/src/views.ts), (d) feedback — dataviz
   non-negotiables za sve buduće grafove, (e) project — deploy/cron granica
   (generator je u domovina-rag; ovaj repo samo crta). Konvertiraj relativne
   datume u apsolutne.

3. Predloži mi (bez da odmah radiš) da skeletiramo Vite projekt i prvi render, pa
   čekaj zeleno svjetlo. Kad kažem kreni: `npm create vite@latest . -- --template
   vanilla-ts`, povuci brand iz views.ts, pokreni `dataviz` skill PRIJE chart
   koda, validiraj paletu skriptom, i složi hero tiles + kanali bar + timeline
   area + top govornici leaderboard čitajući iz public/stats.json.

Napomene: pokreni `dataviz` skill prije pisanja ijednog grafa/boje. Za realne
brojke red veličine ~3008 epizoda / ~136k chunkova / 44 kanala / ~2850 sati /
2016–2026 — ali NIKAD ih ne hardkodiraj, uvijek iz stats.json. Nemoj pisati
ClickHouse upite ni SSH deploy ovdje — to je posao domovina-rag repa.
