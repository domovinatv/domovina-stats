// leaderboard.ts — top govornici po epizodama. Reuse horizontalnog bar core-a
// iz bar.ts (jedna serija, ista nijansa). Govornici su entiteti, ne agregat.

import type { Chart, SpeakerRow } from "../types.ts";
import { hbarChart, type HBarRow } from "./bar.ts";
import { num } from "../format.ts";

const TOP_SPEAKERS = 15;

export function leaderboardChart(speakers: SpeakerRow[]): Chart {
  const rows: HBarRow[] = [...speakers]
    .sort((a, b) => b.episodes - a.episodes || b.chunks - a.chunks)
    .slice(0, TOP_SPEAKERS)
    .map((s) => ({
      cat: s.name,
      value: s.episodes,
      tip: [{ label: "odlomci", value: num(s.chunks) }],
    }));

  return hbarChart(rows, "epizoda");
}
