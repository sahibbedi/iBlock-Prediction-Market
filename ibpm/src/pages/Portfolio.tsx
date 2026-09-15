import React from "react";
import { useGetPositions, useGetTransactions, useGetWalletBalance, useRedeemTokens } from "@workspace/api-client-react";
import { withAuthHeaders } from "@/contexts/AuthContext";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, Table, Th, Td, Badge, Button } from "@/components/ui";
import { formatGies, formatDateTime, truncateHash, cn } from "@/lib/utils";
import { Link } from "wouter";
import { Lock, Star } from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("ibpm_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface BadgeDef {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  earned: boolean;
  awardedAt: string | null;
}

export default function Portfolio() {
  const queryClient = useQueryClient();
  const { data: balance } = useGetWalletBalance(withAuthHeaders());
  const { data: positions, isLoading: isPosLoading } = useGetPositions(withAuthHeaders());
  const { data: transactions, isLoading: isTxLoading } = useGetTransactions({ limit: 100 }, withAuthHeaders());
  const redeemMutation = useRedeemTokens(withAuthHeaders());
  const { data: badges = [] } = useQuery<BadgeDef[]>({
    queryKey: ["badges", "me"],
    queryFn: async () => {
      const res = await fetch("/api/badges/me", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const earnedBadges = badges.filter(b => b.earned);

  const handleRedeem = async (marketId: number, outcome: "yes" | "no") => {
    try {
      await redeemMutation.mutateAsync({ data: { marketId, outcome } });
      queryClient.invalidateQueries();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <h1 className="text-3xl font-display font-bold">Portfolio</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">GIES Balance</p>
            <h3 className="text-3xl font-mono font-bold">{formatGies(balance?.giesBalance)}</h3>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Total Value</p>
            <h3 className="text-3xl font-mono font-bold text-primary">{formatGies(balance?.totalPortfolioValue)}</h3>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Unrealized P&L</p>
            <h3 className={cn("text-3xl font-mono font-bold", (balance?.unrealizedPnl || 0) >= 0 ? "text-yes" : "text-no")}>
              {(balance?.unrealizedPnl || 0) >= 0 ? "+" : ""}{formatGies(balance?.unrealizedPnl)}
            </h3>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Realized P&L</p>
            <h3 className={cn("text-3xl font-mono font-bold", (balance?.realizedPnl || 0) >= 0 ? "text-yes" : "text-no")}>
              {(balance?.realizedPnl || 0) >= 0 ? "+" : ""}{formatGies(balance?.realizedPnl)}
            </h3>
          </CardContent>
        </Card>
      </div>

      {/* Badges shelf */}
      {badges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="w-5 h-5 text-primary" />
              Badges
              <span className="text-sm font-normal text-muted-foreground ml-1">
                {earnedBadges.length} / {badges.length} earned
              </span>
              <Link href="/badges" className="ml-auto text-xs text-primary hover:underline font-normal">View all →</Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {badges.map(b => (
                <div
                  key={b.id}
                  title={b.earned ? `${b.name}: ${b.description}` : `${b.name} (locked)`}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all",
                    b.earned
                      ? "border-primary/20 bg-primary/5 text-foreground"
                      : "border-border/30 bg-muted/30 text-muted-foreground opacity-40 grayscale"
                  )}
                >
                  <span className="text-lg leading-none">
                    {b.earned ? b.emoji : <Lock className="w-3.5 h-3.5" />}
                  </span>
                  <span className="font-medium">{b.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr className="border-b border-border">
                <Th>Market</Th>
                <Th>Outcome</Th>
                <Th className="text-right">Tokens</Th>
                <Th className="text-right">Avg Cost</Th>
                <Th className="text-right">Current Value</Th>
                <Th className="text-right">Unrealized P&L</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {positions?.map((pos) => (
                <tr key={`${pos.marketId}-${pos.outcome}`} className="border-b border-border/50">
                  <Td>
                    <Link href={`/markets/${pos.marketId}`} className="hover:text-primary hover:underline font-medium">
                      {pos.marketTitle}
                    </Link>
                  </Td>
                  <Td>
                    <Badge variant={pos.outcome === 'yes' ? 'yes' : 'no'}>{pos.outcome.toUpperCase()}</Badge>
                  </Td>
                  <Td className="text-right font-mono">{pos.tokenAmount.toFixed(2)}</Td>
                  <Td className="text-right font-mono">{formatGies(pos.avgCostBasis)}</Td>
                  <Td className="text-right font-mono font-bold">{formatGies(pos.currentValue)}</Td>
                  <Td className={cn("text-right font-mono font-bold", pos.unrealizedPnl >= 0 ? "text-yes" : "text-no")}>
                    {pos.unrealizedPnl >= 0 ? "+" : ""}{formatGies(pos.unrealizedPnl)}
                  </Td>
                  <Td className="text-right">
                    {pos.marketStatus === 'resolved' ? (
                      <Button size="sm" onClick={() => handleRedeem(pos.marketId, pos.outcome as any)}>Redeem</Button>
                    ) : (
                      <Link href={`/markets/${pos.marketId}`}>
                        <Button size="sm" variant="secondary">Trade</Button>
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
              {!isPosLoading && positions?.length === 0 && (
                <tr><Td colSpan={7} className="text-center py-8 text-muted-foreground">No open positions.</Td></tr>
              )}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr className="border-b border-border">
                <Th>Type</Th>
                <Th>Description</Th>
                <Th className="text-right">Amount (GIES)</Th>
                <Th className="text-right">Hash</Th>
                <Th className="text-right">Date</Th>
              </tr>
            </thead>
            <tbody>
              {transactions?.map((tx) => (
                <tr key={tx.id} className="border-b border-border/50">
                  <Td>
                    <Badge variant="outline" className="uppercase font-mono text-[10px]">{tx.type.replace('_', ' ')}</Badge>
                  </Td>
                  <Td className="max-w-[300px] truncate">{tx.description}</Td>
                  <Td className={cn("text-right font-mono font-bold", tx.amount > 0 ? "text-yes" : "text-foreground")}>
                    {tx.amount > 0 ? "+" : ""}{formatGies(tx.amount)}
                  </Td>
                  <Td className="text-right font-mono text-muted-foreground text-sm">{truncateHash(tx.txHash)}</Td>
                  <Td className="text-right text-sm text-muted-foreground">{formatDateTime(tx.createdAt)}</Td>
                </tr>
              ))}
              {!isTxLoading && transactions?.length === 0 && (
                <tr><Td colSpan={5} className="text-center py-8 text-muted-foreground">No transactions found.</Td></tr>
              )}
            </tbody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}
