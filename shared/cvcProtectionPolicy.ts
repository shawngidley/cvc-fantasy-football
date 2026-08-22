export type CvcContractTier = "two_year" | "three_year";

export function cvcContractTier(salary: number, sourceMarker?: string | null): CvcContractTier {
  const marker = (sourceMarker ?? "").trim().toUpperCase();
  if (marker === "F2" || marker === "T2") return "two_year";
  if (marker === "F3" || marker === "T3") return "three_year";
  return salary < 10 ? "two_year" : "three_year";
}

export function cvcFranchiseTerms(tier: CvcContractTier) {
  return tier === "two_year" ? 2 : 3;
}

export function cvcPriorSeasonSalary(displayedCurrentSalary: number) {
  return Math.max(0, displayedCurrentSalary - 1);
}

export function cvcTransitionSalary(salary: number, tier: CvcContractTier) {
  return tier === "two_year" ? salary * 2 : salary + 10;
}

export function isCvcProtectionYear(expiresYear: number | null | undefined, seasonYear: number) {
  return Number(expiresYear) === seasonYear;
}

export function isCvcFranchiseMarker(sourceMarker?: string | null) {
  return (sourceMarker ?? "").trim().toUpperCase().startsWith("F");
}

export function isCvcHighSalaryTransition(right: { salary_basis?: number | string | null; metadata?: unknown }) {
  const metadata = (right.metadata ?? {}) as { transition_tier?: CvcContractTier };
  return metadata.transition_tier === "three_year" || Number(right.salary_basis ?? 0) >= 10;
}
