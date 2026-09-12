export const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export const normalizeTeam = (value: string) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[value.toLowerCase()] ?? value.toLowerCase());

export type SnapshotPlayer = { id: string; display_name: string; position: string | null; nfl_team: string | null };
export type SnapshotRow = { franchise_id: string; slot_code: string; player: SnapshotPlayer[] | SnapshotPlayer | null };
