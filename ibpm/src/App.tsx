import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AppLayout } from "./components/layout/AppLayout";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Markets from "./pages/Markets";
import MarketDetail from "./pages/MarketDetail";
import Portfolio from "./pages/Portfolio";
import Faucet from "./pages/Faucet";
import Liquidity from "./pages/Liquidity";
import TeacherAdmin from "./pages/TeacherAdmin";
import Leaderboard from "./pages/Leaderboard";
import Ideas from "./pages/Ideas";
import Badges from "./pages/Badges";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient();

// Protected Route Wrapper
function ProtectedRoute({ component: Component, ...rest }: any) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center text-primary">Loading...</div>;
  if (!user) return <Login />;
  
  return (
    <AppLayout>
      <Component {...rest} />
    </AppLayout>
  );
}

function Router() {
  const { user, isLoading } = useAuth();
  
  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>;

  return (
    <Switch>
      <Route path="/">
        {user ? () => <ProtectedRoute component={Dashboard} /> : () => <Login />}
      </Route>
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/markets" component={() => <ProtectedRoute component={Markets} />} />
      <Route path="/markets/:id" component={() => <ProtectedRoute component={MarketDetail} />} />
      <Route path="/portfolio" component={() => <ProtectedRoute component={Portfolio} />} />
      <Route path="/faucet" component={() => <ProtectedRoute component={Faucet} />} />
      <Route path="/liquidity" component={() => <ProtectedRoute component={Liquidity} />} />
      <Route path="/teacher" component={() => <ProtectedRoute component={TeacherAdmin} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={TeacherAdmin} />} />
      <Route path="/leaderboard" component={() => <ProtectedRoute component={Leaderboard} />} />
      <Route path="/ideas" component={() => <ProtectedRoute component={Ideas} />} />
      <Route path="/badges" component={() => <ProtectedRoute component={Badges} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <Router />
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
