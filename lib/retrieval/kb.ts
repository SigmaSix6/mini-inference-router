import kbFile from "@/data/kb.json"
import { buildBm25, searchBm25, type Bm25Index, type KbEntry, type ScoredEntry } from "@/lib/retrieval/bm25"

type KbFile = {
  entries: KbEntry[]
}

let index: Bm25Index | null = null

export function getKbIndex(): Bm25Index {
  if (!index) {
    index = buildBm25((kbFile as KbFile).entries)
  }
  return index
}

export function searchKb(query: string, k = 5): ScoredEntry[] {
  return searchBm25(getKbIndex(), query, k)
}
