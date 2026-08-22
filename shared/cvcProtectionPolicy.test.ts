import { describe, expect, it } from "vitest";
import { cvcContractTier, cvcFranchiseTerms, cvcTransitionSalary, isCvcHighSalaryTransition } from "./cvcProtectionPolicy";

describe("CVC Transition and Franchise policy", () => {
  it("treats under-$10 contracts as two-year and doubles their transition salary", () => {
    expect(cvcContractTier(9)).toBe("two_year");
    expect(cvcFranchiseTerms("two_year")).toBe(2);
    expect(cvcTransitionSalary(9, "two_year")).toBe(18);
  });

  it("treats $10-and-over contracts as three-year and adds $10 on transition", () => {
    expect(cvcContractTier(10)).toBe("three_year");
    expect(cvcFranchiseTerms("three_year")).toBe(3);
    expect(cvcTransitionSalary(20, "three_year")).toBe(30);
  });

  it("retains explicit transition tier after a salary change and identifies high-salary transition history", () => {
    expect(cvcContractTier(18, "T2")).toBe("two_year");
    expect(isCvcHighSalaryTransition({ salary_basis: 12, metadata: { transition_tier: "three_year" } })).toBe(true);
  });
});
