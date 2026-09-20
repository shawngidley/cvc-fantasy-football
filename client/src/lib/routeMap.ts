export const cvcRouteMap = {
  public: ["/", "/standings", "/live", "/rosters", "/lineup/:franchiseId", "/draft", "/auction", "/draft-recap", "/rundown", "/news", "/transactions", "/trades", "/free-agents", "/results", "/schedule", "/history", "/playoffs", "/rules", "/nfl-sites", "/money", "/player/:playerId", "/login"],
  protected: ["/lineup", "/protections", "/protections/:franchiseId", "/settings", "/commissioner"],
} as const;
