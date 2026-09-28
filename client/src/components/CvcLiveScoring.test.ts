import { describe, expect, it } from "vitest";
import { statChips } from "./CvcLiveScoring";

describe("statChips (using the real confirmed live Drake Maye stat line)", () => {
  it("shows both passing and rushing chips for a dual-threat QB stat line", () => {
    const drakeMayeStat = {
      Rushing: { rushAvg: "4.7", rushYds: "14", carries: "3", longRush: "10", rushTD: "0" },
      Passing: { passAttempts: "4", passTD: "0", passYds: "21", int: "0", passCompletions: "3" },
    };
    const chips = statChips(drakeMayeStat);
    expect(chips).toContainEqual({ label: "C/ATT", value: "3/4" });
    expect(chips).toContainEqual({ label: "YDS", value: "21" });
    expect(chips).toContainEqual({ label: "CAR", value: "3" });
    // Both categories' YDS chips are present (one for passing, one for rushing) --
    // confirms rushing wasn't skipped just because passing chips were already added.
    expect(chips.filter(chip => chip.label === "YDS")).toHaveLength(2);
  });

  it("shows receiving chips for a receiver stat line", () => {
    const jsnStat = { Receiving: { receptions: "2", recTD: "0", longRec: "13", targets: "2", recYds: "21", recAvg: "10.5" } };
    expect(statChips(jsnStat)).toContainEqual({ label: "REC", value: "2/2" });
  });

  it("omits a category with zero attempts (e.g. a backup QB who hasn't thrown yet)", () => {
    const noAttempts = { Passing: { passAttempts: "0", passCompletions: "0", passYds: "0", passTD: "0", int: "0" } };
    expect(statChips(noAttempts)).toEqual([]);
  });

  it("returns an empty array for null/undefined (no stat line yet)", () => {
    expect(statChips(null)).toEqual([]);
    expect(statChips(undefined)).toEqual([]);
  });

  // fa2e6ce deliberately dropped the TKL chip: tackles have no CVC scoring rule, so
  // it was informational only, and it also showed up on offensive players who happen
  // to record a tackle (Tank01 attaches a Defense block to them). A defender with
  // tackles but no scoring stat should now show no chips at all.
  it("omits the TKL chip (tackles aren't a CVC scoring category), even for a defender who racked up several", () => {
    const defenderStat = { Defense: { totalTackles: "5", defTD: "0", forcedFumbles: "0", soloTackles: "4", tfl: "0", qbHits: "0", defensiveInterceptions: "0", sacks: "0", passDeflections: "0" } };
    expect(statChips(defenderStat)).toEqual([]);
  });

  it("shows defensive chips only for nonzero scoring categories, for an individual defender", () => {
    const defenderStat = { Defense: { totalTackles: "5", defTD: "0", forcedFumbles: "0", soloTackles: "4", tfl: "0", qbHits: "0", defensiveInterceptions: "0", sacks: "1", passDeflections: "0" } };
    const chips = statChips(defenderStat);
    expect(chips).toContainEqual({ label: "SACK", value: "1" });
    expect(chips.some(chip => chip.label === "TKL")).toBe(false);
    expect(chips.some(chip => chip.label === "INT")).toBe(false);
  });

  it("shows a fumble-recovery chip for DST -- the actual confirmed bug: the real Week 1 CLE@JAX box score had Jacksonville's DST at fumblesRecovered: 1, sacks: 5, defensiveInterceptions: 1, but the live UI only ever showed SACK and INT, with no FR chip at all, even though the raw data (and the points total) had it", () => {
    const jaxDst = { Defense: { teamAbv: "JAX", defTD: "0", defensiveInterceptions: "1", sacks: "5", ydsAllowed: "272", fumblesRecovered: "1", ptsAllowed: "10", safeties: "0" } };
    const chips = statChips(jaxDst, "DST");
    expect(chips).toContainEqual({ label: "SACK", value: "5" });
    expect(chips).toContainEqual({ label: "INT", value: "1" });
    expect(chips).toContainEqual({ label: "FR", value: "1" });
    // Also confirms the new points-allowed chip, using this same real confirmed value.
    expect(chips).toContainEqual({ label: "PTS AGST", value: "10" });
  });

  // Fumble recovery has no CVC scoring rule outside DST (cvcScoring.ts only awards
  // fumble_recovery when position === "DST"), but Tank01 attaches a Defense block to
  // an offensive player too if they happen to recover one -- the actual confirmed
  // bug: a live screenshot showed a TE (T. Kraft, GB) with an "FR 1" chip alongside
  // his real receiving line, even though a TE's fumble recovery scores nothing in
  // CVC. Same latent-chip-for-a-non-scoring-stat pattern as the TKL chip (fa2e6ce).
  it("omits the FR chip for a non-DST player who recovered a fumble, since it doesn't score for them", () => {
    const teWithFumbleRecovery = { Receiving: { receptions: "4", targets: "8", recYds: "26", recTD: "0" }, Defense: { fumblesRecovered: "1" } };
    const chips = statChips(teWithFumbleRecovery, "TE");
    expect(chips).toContainEqual({ label: "REC", value: "4/8" });
    expect(chips.some(chip => chip.label === "FR")).toBe(false);
  });

  it("still shows the FR chip for a DST that recovered a fumble, even alongside a receiving-position case with no position passed at all (undefined defaults to non-DST, matching the safer omit-by-default behavior)", () => {
    const unknownPositionFumble = { Defense: { fumblesRecovered: "1" } };
    expect(statChips(unknownPositionFumble).some(chip => chip.label === "FR")).toBe(false);
    expect(statChips(unknownPositionFumble, "DST")).toContainEqual({ label: "FR", value: "1" });
  });

  it("shows a defensive-TD chip and a safety chip for DST when nonzero, also previously missing entirely", () => {
    const bigPlayDst = { Defense: { defTD: "1", safeties: "1", sacks: "0", defensiveInterceptions: "0", fumblesRecovered: "0" } };
    const chips = statChips(bigPlayDst);
    expect(chips).toContainEqual({ label: "DEF TD", value: "1" });
    expect(chips).toContainEqual({ label: "SFTY", value: "1" });
  });

  it("omits fumble-recovery/def-TD/safety chips when they're zero, matching the existing sack/int behavior", () => {
    const quietDst = { Defense: { sacks: "0", defensiveInterceptions: "0", fumblesRecovered: "0", defTD: "0", safeties: "0" } };
    const chips = statChips(quietDst);
    expect(chips).toEqual([]);
  });

  it("shows the points-allowed chip at exactly 20 (the top of CVC's bonus tiers), but not at 21", () => {
    const twenty = { Defense: { ptsAllowed: "20" } };
    expect(statChips(twenty)).toContainEqual({ label: "PTS AGST", value: "20" });
    const twentyOne = { Defense: { ptsAllowed: "21" } };
    expect(statChips(twentyOne).some(chip => chip.label === "PTS AGST")).toBe(false);
  });

  it("shows the points-allowed chip at 0 (a shutout), unlike the other chips which hide at zero", () => {
    const shutout = { Defense: { ptsAllowed: "0" } };
    expect(statChips(shutout)).toContainEqual({ label: "PTS AGST", value: "0" });
  });

  it("falls back to ptsAgainst if ptsAllowed isn't present, matching the scoring formula's own field fallback", () => {
    const usingPtsAgainst = { Defense: { ptsAgainst: "13" } };
    expect(statChips(usingPtsAgainst)).toContainEqual({ label: "PTS AGST", value: "13" });
  });
});
