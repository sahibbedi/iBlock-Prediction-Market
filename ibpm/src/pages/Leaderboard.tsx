import React from "react";
import { useGetLeaderboard } from "@workspace/api-client-react";
import { withAuthHeaders } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, Table, Th, Td, Badge } from "@/components/ui";
import { formatGies, cn } from "@/lib/utils";
import { Trophy, Medal, Award } from "lucide-react";

export default function Leaderboard() {
  const { data: leaderboard, isLoading } = useGetLeaderboard({}, withAuthHeaders());

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="text-center space-y-2 pt-8 mb-8">
        <Trophy className="w-16 h-16 mx-auto text-primary mb-4" />
        <h1 className="text-4xl font-display font-bold">Cohort Leaderboard</h1>
        <p className="text-muted-foreground text-lg">Ranked by Total Portfolio Value (Balance + Positions)</p>
      </div>

      <Card className="border-primary/20 shadow-2xl shadow-primary/5">
        <CardContent className="p-0">
          <Table>
            <thead>
              <tr className="bg-card/50">
                <Th className="w-16 text-center">Rank</Th>
                <Th>Trader</Th>
                <Th className="text-right">Total Value</Th>
                <Th className="text-right">Total P&L</Th>
                <Th className="text-right">Trades</Th>
                <Th className="text-right">Badges</Th>
              </tr>
            </thead>
            <tbody>
              {leaderboard?.map((entry, idx) => (
                <tr key={entry.userId} className={cn("border-b border-border/50", idx < 3 ? "bg-primary/5" : "")}>
                  <Td className="text-center">
                    {idx === 0 ? <Trophy className="w-5 h-5 mx-auto text-yellow-500" /> :
                     idx === 1 ? <Medal className="w-5 h-5 mx-auto text-gray-400" /> :
                     idx === 2 ? <Award className="w-5 h-5 mx-auto text-amber-600" /> :
                     <span className="font-mono font-bold text-muted-foreground">{entry.rank}</span>}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center font-display font-bold text-sm">
                        {entry.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold">{entry.displayName}</p>
                        <p className="text-xs text-muted-foreground">@{entry.username}</p>
                      </div>
                      {entry.role === 'market_maker' && <Badge variant="outline" className="text-[10px]">MM</Badge>}
                    </div>
                  </Td>
                  <Td className="text-right font-mono font-bold text-lg text-primary">
                    {formatGies(entry.totalPortfolioValue)}
                  </Td>
                  <Td className={cn("text-right font-mono font-bold", entry.totalPnl >= 0 ? "text-yes" : "text-no")}>
                    {entry.totalPnl >= 0 ? "+" : ""}{formatGies(entry.totalPnl)}
                  </Td>
                  <Td className="text-right font-mono text-muted-foreground">
                    {entry.tradesCount}
                  </Td>
                  <Td className="text-right">
                    {(entry as any).badgeCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-primary font-semibold text-sm">
                        ⭐ {(entry as any).badgeCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </Td>
                </tr>
              ))}
              {isLoading && (
                <tr><Td colSpan={6} className="text-center py-12 text-muted-foreground animate-pulse">Loading rankings...</Td></tr>
              )}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
