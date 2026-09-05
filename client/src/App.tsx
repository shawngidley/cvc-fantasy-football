import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { ProtectedPage } from "@/components/ProtectedPage";
import LeaguePage from "@/pages/LeaguePages";
import Login from "@/pages/Login";
import Auction from "@/pages/Auction";
import Protections from "@/pages/Protections";
import OwnerSettings from "@/pages/OwnerSettings";
import { Redirect, Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useEffect } from "react";

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [location]);
  return null;
}

function Router() {
  return (
    <><ScrollToTop /><Switch>
      <Route path="/" component={() => <LeaguePage kind="standings" />} />
      <Route path="/login" component={Login} />
      <Route path="/standings" component={() => <LeaguePage kind="standings" />} />
      <Route path="/live" component={() => <LeaguePage kind="live" />} />
      <Route path="/rosters" component={() => <LeaguePage kind="rosters" />} />
      <Route path="/lineup"><ProtectedPage><LeaguePage kind="lineup" /></ProtectedPage></Route>
      <Route path="/lineup/:franchiseId"><ProtectedPage><LeaguePage kind="lineup" /></ProtectedPage></Route>
      <Route path="/protections"><ProtectedPage><Protections /></ProtectedPage></Route>
      <Route path="/owner-settings"><ProtectedPage><OwnerSettings /></ProtectedPage></Route>
      <Route path="/draft"><Redirect to="/auction" /></Route>
      <Route path="/auction" component={() => <Auction />} />
      <Route path="/auction/control"><ProtectedPage commissioner><Auction controls /></ProtectedPage></Route>
      <Route path="/draft-recap" component={() => <LeaguePage kind="draft-recap" />} />
      <Route path="/rundown" component={() => <LeaguePage kind="rundown" />} />
      <Route path="/news" component={() => <LeaguePage kind="news" />} />
      <Route path="/transactions" component={() => <LeaguePage kind="transactions" />} />
      <Route path="/trades" component={() => <LeaguePage kind="trades" />} />
      <Route path="/free-agents" component={() => <LeaguePage kind="free-agents" />} />
      <Route path="/results" component={() => <LeaguePage kind="results" />} />
      <Route path="/schedule" component={() => <LeaguePage kind="results" />} />
      <Route path="/history" component={() => <LeaguePage kind="history" />} />
      <Route path="/playoffs" component={() => <LeaguePage kind="playoffs" />} />
      <Route path="/rules" component={() => <LeaguePage kind="rules" />} />
      <Route path="/nfl-sites" component={() => <LeaguePage kind="nfl-sites" />} />
      <Route path="/money" component={() => <LeaguePage kind="money" />} />
      <Route path="/player/:playerName" component={() => <LeaguePage kind="player" />} />
      <Route path="/settings"><ProtectedPage commissioner><LeaguePage kind="settings" /></ProtectedPage></Route>
      <Route path="/commissioner"><ProtectedPage commissioner><LeaguePage kind="settings" /></ProtectedPage></Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch></>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
