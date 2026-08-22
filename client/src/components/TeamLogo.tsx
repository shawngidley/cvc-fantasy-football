import { useState } from "react";
import { cn } from "@/lib/utils";

type TeamLogoProps = {
  name: string;
  abbreviation?: string | null;
  logoUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
};

const dimensions = {
  xs: "h-7 w-7 text-[9px]",
  sm: "h-8 w-8 text-[10px]",
  md: "h-10 w-10 text-[11px]",
  lg: "h-14 w-14 text-sm",
  xl: "h-16 w-16 text-base",
};

function initials(name: string, abbreviation?: string | null) {
  return abbreviation?.slice(0, 3).toUpperCase() || name.split(/\s+/).map(word => word[0]).join("").slice(0, 3).toUpperCase();
}

export function TeamLogo({ name, abbreviation, logoUrl, size = "md", className }: TeamLogoProps) {
  const [failed, setFailed] = useState(false);
  return <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-[#102a20] font-black text-white shadow-sm", dimensions[size], className)} title={name}>{logoUrl && !failed ? <img src={logoUrl} alt={`${name} logo`} className="h-full w-full object-contain" onError={() => setFailed(true)} /> : initials(name, abbreviation)}</span>;
}
