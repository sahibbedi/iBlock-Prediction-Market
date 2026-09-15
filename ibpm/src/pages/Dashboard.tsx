import React from "react";
import { useAuth, withAuthHeaders } from "@/contexts/AuthContext";
import { useGetWalletBalance, useListMarkets, useGetPositions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, ProbabilityBar, Badge } from "@/components/ui";
import { formatGies, formatProb, cn } from "@/lib/utils";
import { Link } from "wouter";
import { Wallet, TrendingUp, TrendingDown, ArrowRight, Landmark } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();

  const { data: balance } = useGetWalletBalance(withAuthHeaders());
  const { data: markets } = useListMarkets({ status: "open" }, withAuthHeaders());
  const { data: positions } = useGetPositions(withAuthHeaders());

  const topMarkets = markets?.slice(0, 3) || [];
  const activePositions = positions?.filter(p => p.marketStatus === "open") || [];

  // Desk capital only applies to active market makers.
  const isMaker = (balance as any)?.role === "market_maker";
  const deskBalance = (balance as any)?.deskBalance;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Hero Welcome */}
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between bg-gradient-to-r from-primary/10 via-background to-background p-8 rounded-3xl border border-primary/10">
        <div>
          <h2 className="text-3xl font-display font-bold">Welcome back, {user?.displayName}</h2>
          <p className="text-muted-foreground mt-1 text-lg">Your portfolio is looking strong today.</p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-6", isMaker ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <Card className="bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Available Balance</p>
              <h3 className="text-2xl font-mono font-bold">{formatGies(balance?.giesBalance)}</h3>
            </div>
          </CardContent>
        </Card>

        {isMaker && (
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Desk Capital</p>
                <h3 className="text-2xl font-mono font-bold">{formatGies(deskBalance)}</h3>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Portfolio Value</p>
              <h3 className="text-2xl font-mono font-bold">{formatGies(balance?.totalPortfolioValue)}</h3>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center",
              (balance?.unrealizedPnl || 0) >= 0 ? "bg-yes/10 text-yes" : "bg-no/10 text-no"
            )}>
              {(balance?.unrealizedPnl || 0) >= 0 ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Unrealized P&L</p>
              <h3 className={cn("text-2xl font-mono font-bold",
                (balance?.unrealizedPnl || 0) >= 0 ? "text-yes" : "text-no"
              )}>
                {(balance?.unrealizedPnl || 0) >= 0 ? "+" : ""}{formatGies(balance?.unrealizedPnl)}
              </h3>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Active Markets Preview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-display font-semibold">Trending Markets</h3>
            <Link href="/markets" className="text-primary hover:underline text-sm font-medium flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          {topMarkets.map(market => (
            <Link key={market.id} href={`/markets/${market.id}`}>
              <Card className="hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all cursor-pointer group">
                <CardContent className="p-5">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="font-semibold group-hover:text-primary transition-colors line-clamp-1">{market.title}</h4>
                    <Badge variant="outline">{market.category}</Badge>
                  </div>
                  <ProbabilityBar yesPrice={market.yesPrice} className="mb-2" />
                  <div className="flex justify-between text-sm font-mono mt-2">
                    <span className="text-yes font-bold">{formatProb(market.yesPrice)} YES</span>
                    <span className="text-no font-bold">{formatProb(market.noPrice)} NO</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {topMarkets.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No active markets available.</CardContent></Card>
          )}
        </div>

        {/* Active Positions Preview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-display font-semibold">Your Active Positions</h3>
            <Link href="/portfolio" className="text-primary hover:underline text-sm font-medium flex items-center gap-1">
              View Portfolio <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          {activePositions.slice(0, 3).map(pos => (
            <Link key={`${pos.marketId}-${pos.outcome}`} href={`/markets/${pos.marketId}`}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex-1 pr-4">
                    <h4 className="font-medium text-sm line-clamp-1 mb-1">{pos.marketTitle}</h4>
                    <div className="flex items-center gap-2">
                      <Badge variant={pos.outcome === "yes" ? "yes" : "no"}>{pos.outcome.toUpperCase()}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">{pos.tokenAmount.toLocaleString()} tokens</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold">{formatGies(pos.currentValue)}</p>
                    <p className={cn("text-xs font-mono", pos.unrealizedPnl >= 0 ? "text-yes" : "text-no")}>
                      {pos.unrealizedPnl >= 0 ? "+" : ""}{formatGies(pos.unrealizedPnl)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {activePositions.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground">You have no active positions.</CardContent></Card>
          )}
        </div>
      </div>

    </div>
  );
}
