export const cvcRouteMap = {
  public: ["/", "/standings", "/live", "/rosters", "/lineup/:franchiseId", "/draft-recap", "/rundown", "/news", "/transactions", "/trades", "/free-agents", "/results", "/schedule", "/history", "/playoffs", "/rules", "/nfl-sites", "/money", "/player/:playerId", "/login"],
  protected: ["/lineup", "/protections", "/settings", "/commissioner"],
} as const;
