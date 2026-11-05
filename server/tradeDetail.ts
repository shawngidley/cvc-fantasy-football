import { one } from "../shared/relation";

type Rel<T> = T | T[] | null | undefined;
type TradeAssetRow = {
  from_franchise_id: string;
  player?: Rel<{ display_name?: string | null; position?: string | null; nfl_team?: string | null }>;
  pick?: Rel<{ round_number?: number | null; pick_number?: number | null; draft?: Rel<{ draft_type?: string | null; season?: Rel<{ year?: number | null }> }> }>;
};
export type TradeOfferRow = {
  id: string;
  proposer_franchise_id: string;
  recipient_franchise_id: string;
  proposer?: Rel<{ name?: string | null }>;
  recipient?: Rel<{ name?: string | null }>;
  assets?: TradeAssetRow[] | null;
};
export type TradeDetail = { sides: { franchise: string; sends: string[] }[] };

const typeLabel = (type?: string | null) => (type === "rookie" ? "Rookie" : type ? type.charAt(0).toUpperCase() + type.slice(1) : "");

export function describeTradeAsset(asset: TradeAssetRow): string | null {
  const player = one(asset.player);
  if (player?.display_name) {
    const tag = [player.position, player.nfl_team].filter(Boolean).join(", ");
    return tag ? `${player.display_name.trim()} (${tag})` : player.display_name.trim();
  }
  const pick = one(asset.pick);
  if (!pick) return null;
  const draft = one(pick.draft);
  const year = one(draft?.season)?.year ?? "";
  return `${year} ${typeLabel(draft?.draft_type)} Draft R${pick.round_number}.${String(pick.pick_number).padStart(2, "0")}`.replace(/\s+/g, " ").trim();
}

/** What each side of an executed trade sends, for the Transactions page. */
export function buildTradeDetail(trade: TradeOfferRow): TradeDetail {
  const sendsFor = (franchiseId: string) => (trade.assets ?? []).filter(asset => asset.from_franchise_id === franchiseId).map(describeTradeAsset).filter((label): label is string => Boolean(label));
  return {
    sides: [
      { franchise: one(trade.proposer)?.name ?? "CVC franchise", sends: sendsFor(trade.proposer_franchise_id) },
      { franchise: one(trade.recipient)?.name ?? "CVC franchise", sends: sendsFor(trade.recipient_franchise_id) },
    ],
  };
}
