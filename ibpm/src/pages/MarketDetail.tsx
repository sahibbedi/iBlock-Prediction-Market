import React, { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetMarket, 
  useGetMarketPriceHistory, 
  useGetTradeQuote, 
  useExecuteTrade,
  useGetPositions,
  getGetMarketQueryKey,
  getGetWalletBalanceQueryKey,
  getGetPositionsQueryKey,
  getGetTransactionsQueryKey,
  getGetMarketTradesQueryKey
} from "@workspace/api-client-react";
import { withAuthHeaders } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input, ProbabilityBar, Table, Th, Td } from "@/components/ui";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatGies, formatProb, formatDateTime, truncateHash, cn } from "@/lib/utils";
import { ArrowLeft, RefreshCw, ChevronDown, ChevronUp, FileText, BookOpen, AlertTriangle, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import MarketComments from "@/components/MarketComments";

export default function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const marketId = parseInt(id, 10);
  const queryClient = useQueryClient();

  const { data: market, isLoading } = useGetMarket(marketId, withAuthHeaders());
  const { data: history } = useGetMarketPriceHistory(marketId, withAuthHeaders());
  const { data: allPositions } = useGetPositions(withAuthHeaders());

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [amountStr, setAmountStr] = useState("");

  const myYesTokens = allPositions?.find(p => p.marketId === marketId && p.outcome === "yes")?.tokenAmount ?? 0;
  const myNoTokens  = allPositions?.find(p => p.marketId === marketId && p.outcome === "no")?.tokenAmount  ?? 0;
  const myTokensForOutcome = outcome === "yes" ? myYesTokens : myNoTokens;
  const amount = parseFloat(amountStr) || 0;

  const [learningOpen, setLearningOpen] = useState(false);

  const quoteMutation = useGetTradeQuote(withAuthHeaders());
  const tradeMutation = useExecuteTrade(withAuthHeaders());

  useEffect(() => {
    if (amount > 0 && market?.status === "open") {
      const timer = setTimeout(() => {
        quoteMutation.mutate({
          data: { marketId, side, outcome, amount, amountType: side === "buy" ? "gies" : "tokens" }
        });
      }, 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [amountStr, side, outcome, marketId, market?.status]);

  const handleTrade = async () => {
    if (amount <= 0) return;
    try {
      await tradeMutation.mutateAsync({
        data: { marketId, side, outcome, amount, amountType: side === "buy" ? "gies" : "tokens" }
      });
      setAmountStr("");
      queryClient.invalidateQueries({ queryKey: getGetMarketQueryKey(marketId) });
      queryClient.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPositionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMarketTradesQueryKey(marketId) });
    } catch (err) {
      console.error("Trade failed", err);
    }
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading market...</div>;
  if (!market) return <div className="p-8 text-center text-destructive">Market not found.</div>;

  const quote = quoteMutation.data;
  const chartData = history?.map(h => ({
    time: formatDateTime(h.timestamp),
    yesPrice: h.yesPrice * 100,
    noPrice: h.noPrice * 100,
    volume: h.volume ?? 0
  })) || [];

  const priceImpact = quote?.priceImpact ?? 0;
  const isBlocked = quote?.isBlocked ?? false;
  const isBootstrapping = quote?.isBootstrapping ?? false;
  const safeguardWarnings = quote?.safeguardWarnings;

  const impactColor = priceImpact > 10
    ? "text-destructive"
    : priceImpact > 5
    ? "text-amber-500"
    : "text-foreground";

  const impactBg = priceImpact > 10
    ? "bg-destructive/10 border-destructive/30"
    : priceImpact > 5
    ? "bg-amber-500/10 border-amber-500/30"
    : null;

  const tradeDisabled =
    amount <= 0 ||
    quoteMutation.isPending ||
    !quote ||
    isBlocked;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href="/markets" className="text-sm font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-2">
        <ArrowLeft className="w-4 h-4" /> Back to Markets
      </Link>

      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <Badge variant="outline">{market.category}</Badge>
            <Badge variant={market.status === 'open' ? 'success' : market.status === 'resolved' ? 'default' : 'warning'}>
              {market.status.toUpperCase()}
            </Badge>
          </div>
          <h1 className="text-3xl font-display font-bold leading-tight">{market.title}</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl">{market.description}</p>
        </div>
      </div>

      {/* Resolution Criteria — always visible */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4 text-primary" />
            Resolution Criteria
          </CardTitle>
        </CardHeader>
        <CardContent>
          {market.resolutionCriteria ? (
            <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{market.resolutionCriteria}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No resolution criteria have been set for this market.</p>
          )}
        </CardContent>
      </Card>

      {/* Learning Panel (collapsible, only if populated) */}
      {market.learningPanel && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-4 text-left bg-card hover:bg-muted/50 transition-colors"
            onClick={() => setLearningOpen(o => !o)}
          >
            <span className="flex items-center gap-2 font-semibold text-sm">
              <BookOpen className="w-4 h-4 text-primary" />
              Learn about this market
            </span>
            {learningOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {learningOpen && (
            <div className="px-5 py-4 bg-card border-t border-border">
              <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{market.learningPanel}</p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Chart & Stats */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <CardTitle>Probability History</CardTitle>
                {(market as any).effectiveVirtualLiquidity > 0 && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium cursor-default"
                    title={`Virtual depth: ${((market as any).effectiveVirtualLiquidity as number).toFixed(0)} GIES remaining — early trades have lower price impact`}
                  >
                    Bootstrapping
                  </span>
                )}
              </div>
              <div className="flex gap-4 font-mono">
                <span className="text-yes font-bold">{formatProb(market.yesPrice)} YES</span>
                <span className="text-no font-bold">{formatProb(market.noPrice)} NO</span>
              </div>
            </CardHeader>
            <CardContent>
              <ProbabilityBar yesPrice={market.yesPrice} className="mb-8 h-3" />
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorYes" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--yes))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--yes))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" hide />
                    <YAxis domain={[0, 100]} tickFormatter={(val) => `${val}%`} width={40} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      itemStyle={{ color: 'hsl(var(--foreground))', fontFamily: 'monospace' }}
                      formatter={(val: number) => [`${val.toFixed(1)}%`, 'Probability']}
                    />
                    <Area type="stepAfter" dataKey="yesPrice" stroke="hsl(var(--yes))" strokeWidth={2} fillOpacity={1} fill="url(#colorYes)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="h-[80px] w-full mt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap="20%">
                    <XAxis dataKey="time" hide />
                    <YAxis width={40} fontSize={10} stroke="hsl(var(--muted-foreground))" tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(0)}k` : String(val)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      itemStyle={{ color: 'hsl(var(--foreground))', fontFamily: 'monospace' }}
                      formatter={(val: number) => [formatGies(val), 'Volume']}
                      labelFormatter={() => ''}
                    />
                    <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill="hsl(var(--primary))" fillOpacity={0.6} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground font-mono mt-2 pt-4 border-t border-border">
                <span>Pool: {formatGies(market.yesPool)} / {formatGies(market.noPool)}</span>
                <span>Volume: {formatGies(market.totalVolume)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Trades</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <Th>User</Th>
                    <Th>Action</Th>
                    <Th className="text-right">Tokens</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">Hash</Th>
                  </tr>
                </thead>
                <tbody>
                  {market.recentTrades.map(trade => (
                    <tr key={trade.id} className="border-b border-border/50 font-mono text-sm">
                      <Td>{trade.username}</Td>
                      <Td>
                        <span className={cn("font-bold", trade.outcome === 'yes' ? 'text-yes' : 'text-no')}>
                          {trade.side.toUpperCase()} {trade.outcome.toUpperCase()}
                        </span>
                      </Td>
                      <Td className="text-right">{trade.tokenAmount.toFixed(2)}</Td>
                      <Td className="text-right">{formatGies(trade.pricePerToken)}</Td>
                      <Td className="text-right text-muted-foreground">{truncateHash(trade.txHash)}</Td>
                    </tr>
                  ))}
                  {market.recentTrades.length === 0 && (
                    <tr><Td colSpan={5} className="text-center py-4 text-muted-foreground">No trades yet</Td></tr>
                  )}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Trade Interface */}
        <div className="space-y-6">
          <Card className="border-primary/20 shadow-xl shadow-primary/5 sticky top-24">
            <CardHeader className="bg-card pb-4 border-b border-border">
              <CardTitle>Trade</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {market.status !== 'open' ? (
                <div className="text-center py-8">
                  <Badge variant="warning" className="text-lg px-4 py-2 mb-4">Market Closed</Badge>
                  <p className="text-muted-foreground">Trading is no longer available.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Action Tabs */}
                  <div className="flex p-1 bg-background rounded-xl border border-border">
                    {(["buy", "sell"] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => { setSide(s); setAmountStr(""); }}
                        className={cn(
                          "flex-1 py-2 text-sm font-semibold rounded-lg capitalize transition-all",
                          side === s ? "bg-card shadow-md text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  {/* Outcome Selector */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setOutcome("yes"); setAmountStr(""); }}
                      className={cn(
                        "flex-1 py-3 px-4 rounded-xl border-2 font-bold font-mono transition-all",
                        outcome === "yes" ? "border-yes bg-yes/10 text-yes" : "border-border text-muted-foreground hover:border-yes/50"
                      )}
                    >
                      YES <span className="text-xs font-normal ml-1 opacity-70">@ {formatProb(market.yesPrice)}</span>
                    </button>
                    <button
                      onClick={() => { setOutcome("no"); setAmountStr(""); }}
                      className={cn(
                        "flex-1 py-3 px-4 rounded-xl border-2 font-bold font-mono transition-all",
                        outcome === "no" ? "border-no bg-no/10 text-no" : "border-border text-muted-foreground hover:border-no/50"
                      )}
                    >
                      NO <span className="text-xs font-normal ml-1 opacity-70">@ {formatProb(market.noPrice)}</span>
                    </button>
                  </div>

                  {/* Your Position */}
                  {(myYesTokens > 0 || myNoTokens > 0) && (
                    <div className="rounded-lg bg-muted/40 border border-border/50 px-3 py-2.5 space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Your Position</p>
                      <div className="flex gap-4 font-mono text-sm">
                        {myYesTokens > 0 && (
                          <span className={cn("font-bold", outcome === "yes" && side === "sell" ? "text-yes" : "text-foreground")}>
                            {myYesTokens.toFixed(2)} <span className="text-yes">YES</span>
                          </span>
                        )}
                        {myNoTokens > 0 && (
                          <span className={cn("font-bold", outcome === "no" && side === "sell" ? "text-no" : "text-foreground")}>
                            {myNoTokens.toFixed(2)} <span className="text-no">NO</span>
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Input */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <label className="font-medium text-muted-foreground">
                        {side === "buy" ? "Investment (GIES)" : `Tokens to Sell`}
                      </label>
                      {side === "sell" && myTokensForOutcome > 0 && (
                        <button
                          className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                          onClick={() => setAmountStr(myTokensForOutcome.toFixed(6))}
                        >
                          Max ({myTokensForOutcome.toFixed(2)})
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0.00"
                        value={amountStr}
                        onChange={(e) => setAmountStr(e.target.value)}
                        className="pl-4 pr-16 font-mono text-lg"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm font-semibold pointer-events-none">
                        {side === "buy" ? "GIES" : "TKN"}
                      </div>
                    </div>
                    {side === "sell" && amount > myTokensForOutcome && myTokensForOutcome > 0 && (
                      <p className="text-xs text-destructive font-medium">
                        Exceeds your balance of {myTokensForOutcome.toFixed(2)} {outcome.toUpperCase()} tokens
                      </p>
                    )}
                  </div>

                  {/* Quote Breakdown */}
                  {amount > 0 && (
                    <div className={cn(
                      "rounded-xl p-4 space-y-2 border text-sm font-mono",
                      impactBg ?? "bg-background border-border/50"
                    )}>
                      {quoteMutation.isPending ? (
                        <div className="flex items-center justify-center py-4 text-primary">
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        </div>
                      ) : quote ? (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Est. Tokens</span>
                            <span className="font-bold">{quote.tokenAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Avg Price</span>
                            <span>{formatGies(quote.pricePerToken)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Price Impact</span>
                            <span className={impactColor}>
                              {priceImpact.toFixed(2)}%
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Effective Fee</span>
                            <span>{(quote.effectiveFeeRate * 100).toFixed(2)}%</span>
                          </div>
                          <div className="pt-2 mt-2 border-t border-border/50 flex justify-between font-bold">
                            <span className="font-sans">New Price</span>
                            <span>{formatProb(outcome === 'yes' ? quote.newYesPrice : quote.newNoPrice)}</span>
                          </div>

                          {/* Safeguard Warnings */}
                          {safeguardWarnings && safeguardWarnings.length > 0 && (
                            <div className="pt-2 mt-2 border-t border-border/50 space-y-1">
                              {safeguardWarnings.map((w, i) => (
                                <div key={i} className={cn(
                                  "flex items-start gap-1.5 text-xs font-sans",
                                  isBlocked ? "text-destructive" : "text-amber-500"
                                )}>
                                  {isBlocked
                                    ? <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  }
                                  <span>{w}</span>
                                </div>
                              ))}
                              {isBootstrapping && !isBlocked && (
                                <p className="text-xs font-sans text-primary/80 pt-1">
                                  Price impact limits are relaxed while this market is bootstrapping.
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      ) : quoteMutation.isError ? (
                        <div className="text-destructive font-sans">Error calculating quote.</div>
                      ) : null}
                    </div>
                  )}

                  {/* Submit */}
                  <Button 
                    variant={outcome === 'yes' ? 'yes' : 'no'} 
                    size="lg" 
                    className="w-full text-lg shadow-xl"
                    disabled={tradeDisabled}
                    isLoading={tradeMutation.isPending}
                    onClick={handleTrade}
                  >
                    {isBlocked
                      ? "Trade Blocked"
                      : side === "buy" ? "Place Order" : "Sell Position"
                    }
                  </Button>
                  {tradeMutation.isError && (
                    <p className="text-destructive text-sm text-center">
                      {(tradeMutation.error as any)?.response?.data?.error || "Trade failed"}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <MarketComments marketId={marketId} />
    </div>
  );
}
