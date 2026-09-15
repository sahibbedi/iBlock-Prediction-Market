import React, { useState } from "react";
import { useListMarkets } from "@workspace/api-client-react";
import { withAuthHeaders } from "@/contexts/AuthContext";
import { Card, CardContent, ProbabilityBar, Badge, Input } from "@/components/ui";
import { Link } from "wouter";
import { formatProb, formatGies } from "@/lib/utils";
import { Search, MessageSquare } from "lucide-react";

export default function Markets() {
  const [filter, setFilter] = useState<"open" | "closed" | "resolved">("open");
  const [search, setSearch] = useState("");

  const { data: markets, isLoading } = useListMarkets({ status: filter }, withAuthHeaders());

  const filteredMarkets = markets?.filter(m => 
    m.title.toLowerCase().includes(search.toLowerCase()) || 
    m.category.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-3xl font-display font-bold">Prediction Markets</h1>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search markets..." 
              className="pl-9 bg-card border-border/50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex bg-card p-1 rounded-xl border border-border">
            {(["open", "closed", "resolved"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg capitalize transition-colors ${filter === f ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Card key={i} className="h-48 animate-pulse bg-card/50" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMarkets.map(market => (
            <Link key={market.id} href={`/markets/${market.id}`}>
              <Card className="h-full flex flex-col hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all cursor-pointer">
                <CardContent className="p-6 flex flex-col flex-1">
                  <div className="flex justify-between items-start mb-4 gap-2">
                    <Badge variant="outline" className="shrink-0">{market.category}</Badge>
                    {market.status === "resolved" && <Badge variant={market.outcome === "yes" ? "yes" : "no"}>Resolved: {market.outcome?.toUpperCase()}</Badge>}
                    {market.status === "closed" && <Badge variant="warning">Trading Closed</Badge>}
                  </div>
                  
                  <h3 className="text-lg font-semibold mb-4 flex-1 line-clamp-3 leading-snug">
                    {market.title}
                  </h3>

                  <div className="mt-auto pt-4 border-t border-border/50">
                    <ProbabilityBar yesPrice={market.yesPrice} className="h-2.5 mb-3" />
                    <div className="flex justify-between items-center text-sm">
                      <div className="flex flex-col">
                        <span className="text-yes font-bold font-mono text-lg">{formatProb(market.yesPrice)}</span>
                        <span className="text-muted-foreground text-xs uppercase tracking-wider">Yes</span>
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-no font-bold font-mono text-lg">{formatProb(market.noPrice)}</span>
                        <span className="text-muted-foreground text-xs uppercase tracking-wider">No</span>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground font-mono">
                      <span>Vol: {formatGies(market.totalVolume)}</span>
                      {(market as any).commentCount > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground/80">
                          <MessageSquare className="w-3 h-3" />
                          {(market as any).commentCount}
                        </span>
                      )}
                      <span>Liq: {formatGies(market.totalLiquidity)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {filteredMarkets.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              No markets found matching your criteria.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
