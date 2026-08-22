import { describe, expect, it } from "vitest";
import { cvcRouteMap } from "./routeMap";

describe("CVC route contract", () => {
  it("includes every required league view and protected workspace", () => {
    const allRoutes = [...cvcRouteMap.public, ...cvcRouteMap.protected];
    ["/standings", "/live", "/lineup", "/draft", "/draft-lottery", "/draft-recap", "/transactions", "/trades", "/free-agents", "/results", "/history", "/playoffs", "/rules", "/nfl-sites", "/rosters", "/money", "/settings", "/player/:playerId", "/login"].forEach(path => expect(allRoutes).toContain(path));
  });

  it("keeps owner and commissioner workspaces protected", () => {
    expect(cvcRouteMap.protected).toEqual(expect.arrayContaining(["/lineup", "/settings", "/commissioner"]));
  });
});
