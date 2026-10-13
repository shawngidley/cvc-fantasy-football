import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Supabase silently caps a select at 1000 rows. CVC has 10 franchises and about 15 to 22
// lineup rows each, so one week is roughly 150 to 220 rows and a season wide read would pass
// 1000 around week 5 to 7. Every weekly_lineup_snapshot select must stay scoped to one week.
describe("weekly_lineup_snapshot reads stay scoped to a single week", () => {
  const files = [...readdirSync("server").filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).map(f => join("server", f)), ...readdirSync("server/routers").filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).map(f => join("server/routers", f))];
  it("every select is filtered by schedule_week_id", () => {
    const bad: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/from\("weekly_lineup_snapshot"\)\.select/.test(line) && !/\.eq\("schedule_week_id"/.test(line)) bad.push(`${file}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
