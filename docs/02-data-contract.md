# 02 — Data contract: `stats.json`

Ovo je jedini ugovor između `domovina-rag` (producer snapshota) i ovog repa
(consumer). Frontend smije ovisiti SAMO o ovom shape-u.

## Lokacija

- Producer piše u: `domovina-stats/public/stats.json`
- Frontend fetcha na: `/stats.json` (Vite kopira `public/` u `dist/`)

## Shape

```jsonc
{
  "generated_at": "2026-07-03T04:12:00Z",   // ISO 8601 UTC, bash `date -u`
  "source": "cloud",                          // "cloud" | "local"
  "totals": {
    "episodes": 3008,        // uniqExact(youtube_id), length=11
    "chunks": 136513,        // count()
    "channels": 44,          // uniqExact(channel)
    "hours": 2850,           // sum(end_ts-start_ts)/3600, zaokruženo
    "speakers": 0,           // distinct imenovani govornici (NE SPEAKER_XX)
    "first_date": "2016-02-18",
    "last_date": "2026-06-25"
  },
  "channels": [              // sortirano po episodes DESC
    { "channel": "domovina_tv", "episodes": 812, "chunks": 41230, "hours": 903.4 }
    // …
  ],
  "timeline": [              // po mjesecu, ASC
    { "month": "2016-02-01", "episodes": 3, "chunks": 140 }
    // …
  ],
  "top_speakers": [          // top 15 po episodes DESC
    { "name": "Ime Prezime", "episodes": 120, "chunks": 5400 }
    // …
  ]
}
```

**Stvarni red veličine (2026-07-03):** ~3.008 epizoda, ~136.513 chunkova,
44 kanala, ~2.850 sati, korpus 2016-02-18 → 2026-06-25. Frontend NE smije
hardkodirati ove brojke — uvijek iz `stats.json`.

## ClickHouse upiti (referenca — izvršavaju se u domovina-rag)

Konekcija (isti pattern kao `sync-speakers.sh` — discover container, `--cloud`
preko SSH-a). Filtriraj `length(youtube_id)=11` (izbacuje junk orfane, npr. `λ`).

### totals
```sql
SELECT count() AS chunks,
       uniqExact(youtube_id) AS episodes,
       uniqExact(channel) AS channels,
       round(sum(end_ts - start_ts) / 3600) AS hours,
       toString(min(upload_date)) AS first_date,
       toString(max(upload_date)) AS last_date
FROM rag_chunks
WHERE length(youtube_id) = 11
FORMAT JSON;
```

### speakers_raw (svi distinct raw govornici — broj i leaderboard računa python)
Broj govornika i `top_speakers` se NE računaju naivnim `uniqExact`-om. Umjesto
toga `emit_stats_json.py` uzima sve distinct raw labele i pušta ih kroz
`build_persons` iz person huba (`services/etl/etl/speakers.py`) — isti role-filter
(izbacuje "Voditelj", "Gost 1", "UNKNOWN", `SPEAKER_XX`…) i dedup varijanti
("fra Stjepan Brčina" + "Fra Stjepan Brčina" → jedna osoba). Rezultat:
**`totals.speakers` == broj u PG `speakers` (person hub) / `/api/person`.**

```sql
SELECT trim(BOTH ' ' FROM arrayJoin(splitByChar(',', speaker))) AS raw,
       count() AS chunks,
       uniqExact(youtube_id) AS episodes,
       arrayStringConcat(arraySort(groupUniqArray(channel)), '|') AS channels
FROM rag_chunks
WHERE length(youtube_id) = 11
GROUP BY raw HAVING raw != ''
FORMAT JSON;
```
`top_speakers` = top N osoba (po epizodama, pa chunkovima) nakon `build_persons`.

### channels
```sql
SELECT channel,
       uniqExact(youtube_id) AS episodes,
       count() AS chunks,
       round(sum(end_ts - start_ts) / 3600, 1) AS hours
FROM rag_chunks
WHERE length(youtube_id) = 11
GROUP BY channel
ORDER BY episodes DESC
FORMAT JSON;
```

### timeline (po mjesecu)
```sql
SELECT toString(toStartOfMonth(upload_date)) AS month,
       uniqExact(youtube_id) AS episodes,
       count() AS chunks
FROM rag_chunks
WHERE length(youtube_id) = 11 AND upload_date >= '2010-01-01'
GROUP BY month
ORDER BY month
FORMAT JSON;
```

## Vector map (Razina 2 — `/map`)

Drugi artefakt istog producera (`domovina-rag/scripts/sync-vector-map.sh` →
`emit_vector_map.py`, dedicated venv s umap-learn): UMAP 2D projekcija SVIH
chunk embeddinga iz LOKALNOG CH-a. Frontend `/map` (src/map.ts, WebGL2) čita:

- **`public/vector-map.bin`** — N × 4 × uint16 little-endian po točki:
  `x`, `y` (kvantizirano na [0,65535], očuvan aspect ratio),
  `ep_idx` (indeks u `episodes` iz meta JSON-a), `t_sec` (start isječka,
  za player deep-link `https://domovina.ai/v/{id}/t/{sec}`).
- **`public/vector-map-3d.bin`** — N × 3 × uint16 LE: `x`, `y`, `z` — zaseban
  UMAP 3D fit, ISTI poredak točaka kao 2D bin (ep/t se ne ponavlja). Frontend
  ga lazy-loada tek na 3D toggle.
- **`public/vector-map.json`** — `{schema_version: 1, generated_at, source,
  points, source_rows, channels: [ime… po chunkovima DESC],
  episodes: [[youtube_id, channel_idx, title, date]…],
  clusters: [{label, x, y, x3, y3, z3, n, eps}…]}`.
  `source_rows` je sirovi CH count — producer po njemu preskače UMAP kad nema
  novih chunkova. Boje: prvih 8 `channels` = kategorički slotovi, ostali agregat.
  `clusters` = HDBSCAN(leaf) sidra tema: kvantizirani centri u 2D i 3D prostoru,
  `label` = Gemini ime (može biti `""` → frontend skipa), `eps` = top-10
  youtube_id otisak za nasljeđivanje labela između runova kad LLM nije dostupan.
- **`public/vector-map-titles.json`** — debug/ručno-imenovanje sidecar: po
  klasteru top naslovi epizoda (nije ga nužno servirati, ali je bezopasan).
- **`public/vector-map-chap-{00..63}.json`** — chapter shardovi za tooltip:
  `{ "<ep_idx>": [[t_sec, naslov_isječka]…] }`, shard = `ep_idx % 64`. Naslov
  isječka je prva linija chunk texta (`Tema:`/`Naslov:` prefiks, do 90 znakova).
  Frontend sharda lazy-fetcha tek na hover/tap i kešira; ~160 kB po shardu.
  `clusters[].l`: 0 = glavna tema, 1 = podtema (frontend je otkriva tek na
  zoomu ≥ 1.6, viewport-aware budžet).

Frontend graceful degradira: ako fajlovi ne postoje (404), `/map` prikaže
poruku umjesto mape; dashboard `/` ne ovisi o njima.

## Verzioniranje

Ako mijenjaš shape → bump `stats.json` (dodaj `"schema_version": 1`), pa update
frontend. Consumer mora graceful degradirati (npr. `top_speakers` može
nedostajati) — render samo sekcije koje postoje.
