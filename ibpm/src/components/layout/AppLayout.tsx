import React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { LayoutDashboard, LineChart, Wallet, Trophy, Droplet, Users, LogOut, ShieldAlert, Lightbulb, Star, Settings } from "lucide-react";
import { formatGies, cn } from "@/lib/utils";
import { Badge } from "@/components/ui";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["observer", "trader", "market_maker", "admin"] },
  { href: "/markets", label: "Markets", icon: LineChart, roles: ["observer", "trader", "market_maker", "admin"] },
  { href: "/portfolio", label: "Portfolio", icon: Wallet, roles: ["observer", "trader", "market_maker", "admin"] },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy, roles: ["observer", "trader", "market_maker", "admin"] },
  { href: "/ideas", label: "Market Ideas", icon: Lightbulb, roles: ["observer", "trader", "market_maker", "admin"] },
  { href: "/badges", label: "Badges", icon: Star, roles: ["observer", "trader", "market_maker", "admin"] },
  { href: "/liquidity", label: "Liquidity Pools", icon: Droplet, roles: ["market_maker"] },
  { href: "/admin", label: "Admin Console", icon: ShieldAlert, roles: ["admin"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["observer", "trader", "market_maker", "admin"] },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  if (!user) return <div className="min-h-screen bg-background" />;

  const visibleNavItems = navItems.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col z-20">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center font-display font-bold text-primary-foreground shadow-lg shadow-primary/20">
              i
            </div>
            <span className="font-display font-bold text-xl tracking-tight">iBPM</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          <div className="mb-6 px-2">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Navigation</p>
            {visibleNavItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors mb-1",
                  location.startsWith(item.href) 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-border bg-card/50">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-display font-bold">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-none">{user.displayName}</span>
              <span className="text-xs text-muted-foreground mt-1 capitalize">{user.role.replace('_', ' ')}</span>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-8 z-10 sticky top-0">
          <h1 className="text-xl font-display font-semibold capitalize">
            {location.split('/')[1] || "Dashboard"}
          </h1>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="px-4 py-1.5 text-sm gap-2">
              <span className="text-muted-foreground">Balance:</span>
              <span className="text-primary">{formatGies(user.giesBalance)}</span>
            </Badge>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8 relative">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
