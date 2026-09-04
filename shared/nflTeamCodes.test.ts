import { describe, expect, it } from "vitest";
import { normalizeNFLTeamCode } from "./nflTeamCodes";

describe("normalizeNFLTeamCode", () => {
  it("maps nflverse's Rams code to CVC's canonical LAR", () => {
    expect(normalizeNFLTeamCode("LA")).toBe("LAR");
  });

  it("maps Jacksonville and Washington variants to CVC's canonical codes", () => {
    expect(normalizeNFLTeamCode("JAX")).toBe("JAC");
    expect(normalizeNFLTeamCode("WAS")).toBe("WSH");
    expect(normalizeNFLTeamCode("WSN")).toBe("WSH");
  });

  it("leaves already-canonical codes unchanged", () => {
    expect(normalizeNFLTeamCode("JAC")).toBe("JAC");
    expect(normalizeNFLTeamCode("LAR")).toBe("LAR");
    expect(normalizeNFLTeamCode("LAC")).toBe("LAC");
    expect(normalizeNFLTeamCode("WSH")).toBe("WSH");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeNFLTeamCode(" la ")).toBe("LAR");
    expect(normalizeNFLTeamCode("jax")).toBe("JAC");
  });

  it("handles null/undefined gracefully", () => {
    expect(normalizeNFLTeamCode(null)).toBe("");
    expect(normalizeNFLTeamCode(undefined)).toBe("");
  });
});
