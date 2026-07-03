// types.ts — mirror data contract-a (docs/02-data-contract.md).
// Frontend ovisi SAMO o ovom shape-u. Consumer graceful degradira:
// sve osim `totals` je opcionalno — render samo sekcije koje postoje.

export interface StatsTotals {
  episodes: number;
  chunks: number;
  channels: number;
  hours: number;
  speakers: number;
  first_date: string; // "YYYY-MM-DD"
  last_date: string;  // "YYYY-MM-DD"
}

export interface ChannelRow {
  channel: string;
  episodes: number;
  chunks: number;
  hours: number;
}

export interface TimelinePoint {
  month: string; // "YYYY-MM-01"
  episodes: number;
  chunks: number;
}

export interface SpeakerRow {
  name: string;
  episodes: number;
  chunks: number;
}

/** Graf koji se sam preriše na zadanu piksel-širinu (responsive bez skaliranja
 *  teksta): main.ts izmjeri container i pozove draw(width). */
export interface Chart {
  el: HTMLElement;
  draw(width: number): void;
}

export interface StatsJson {
  schema_version?: number;
  generated_at: string; // ISO 8601 UTC
  source?: "cloud" | "local";
  totals: StatsTotals;
  channels?: ChannelRow[];
  timeline?: TimelinePoint[];
  top_speakers?: SpeakerRow[];
}
