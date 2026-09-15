import React, { useState } from "react";
import { useGetLiquidityPositions, useProvideLiquidity, useRemoveLiquidity, useListMarkets, useGetWalletBalance } from "@workspace/api-client-react";
import { withAuthHeaders, useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, Table, Th, Td, Button, Modal, Input } from "@/components/ui";
import { formatGies, formatProb } from "@/lib/utils";
import { AlertTriangle, Info } from "lucide-react";

export default function Liquidity() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: positions } = useGetLiquidityPositions(withAuthHeaders());
  const { data: markets } = useListMarkets({ status: "open" }, withAuthHeaders());
  const { data: balance } = useGetWalletBalance(withAuthHeaders());

  const provideMutation = useProvideLiquidity(withAuthHeaders());
  const removeMutation = useRemoveLiquidity(withAuthHeaders());

  const [provideModal, setProvideModal] = useState<{isOpen: boolean, marketId: number | null}>({isOpen: false, marketId: null});
  const [removeModal, setRemoveModal] = useState<{isOpen: boolean, marketId: number | null, maxShares: number}>({isOpen: false, marketId: null, maxShares: 0});
  const [amount, setAmount] = useState("");
  const [ilExpanded, setIlExpanded] = useState(false);

  if (user?.role !== "market_maker" && user?.role !== "teacher" && user?.role !== "admin") {
    return <div className="p-8 text-center text-destructive text-xl">Access Denied. Market Makers only.</div>;
  }

  const handleProvide = async () => {
    if (!provideModal.marketId || !amount) return;
    try {
      await provideMutation.mutateAsync({ data: { marketId: provideModal.marketId, giesAmount: parseFloat(amount) } });
      setProvideModal({ isOpen: false, marketId: null });
      setAmount("");
      queryClient.invalidateQueries();
    } catch (e) {}
  };

  const handleRemove = async () => {
    if (!removeModal.marketId || !amount) return;
    try {
      await removeMutation.mutateAsync({ data: { marketId: removeModal.marketId, lpShares: parseFloat(amount) } });
      setRemoveModal({ isOpen: false, marketId: null, maxShares: 0 });
      setAmount("");
      queryClient.invalidateQueries();
    } catch (e) {}
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-display font-bold">Liquidity Provisioning</h1>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Desk Capital available</p>
          <p className="text-2xl font-mono font-bold">{formatGies((balance as any)?.deskBalance)}</p>
        </div>
      </div>

      {/* LP Education Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="w-4 h-4 text-primary" />
            How Liquidity Providing Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-foreground/90">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg bg-background border border-border p-4">
              <p className="font-semibold mb-1">What LPs Do</p>
              <p className="text-muted-foreground leading-relaxed">
                Liquidity providers deposit GIES into a market's YES/NO pool. This capital lets traders buy and sell
                tokens at any time — you are the counterparty that makes trading possible.
              </p>
            </div>
            <div className="rounded-lg bg-background border border-border p-4">
              <p className="font-semibold mb-1">How You Earn Fees</p>
              <p className="text-muted-foreground leading-relaxed">
                Every trade pays a fee that stays in the pool. Because your LP shares represent a slice of the pool,
                the pool grows with each trade and your shares appreciate. The more liquidity you provide and the more
                trades occur, the more your position is worth.
              </p>
            </div>
            <div className="rounded-lg bg-background border border-border p-4">
              <p className="font-semibold mb-1">Impermanent Loss Risk</p>
              <p className="text-muted-foreground leading-relaxed">
                If the market price moves significantly after you deposit, you may end up with less value than if
                you had simply held GIES. This "impermanent loss" can happen even while you're collecting fees.
              </p>
            </div>
          </div>

          {/* IL explainer toggle */}
          <div className="rounded-lg border border-border bg-background overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
              onClick={() => setIlExpanded(o => !o)}
            >
              <span className="font-semibold text-sm">Plain-language walkthrough: how impermanent loss happens</span>
              <span className="text-muted-foreground text-xs ml-2">{ilExpanded ? "Hide" : "Show"}</span>
            </button>
            {ilExpanded && (
              <div className="px-4 pb-4 border-t border-border space-y-2 text-muted-foreground leading-relaxed">
                <p className="pt-3">
                  Suppose you deposit <strong className="text-foreground">1,000 GIES</strong> into a market where YES and NO are both at 50¢.
                  The pool starts balanced: 500 GIES on the YES side, 500 on the NO side.
                </p>
                <p>
                  Over the next few days, traders pile into YES. The YES price rises to 80¢ and the NO price falls to 20¢.
                  The AMM rebalances the pool — now more of your capital is sitting in the cheaper NO tokens.
                </p>
                <p>
                  When you withdraw, you receive your proportional share of the current pool.
                  Because the pool rebalanced toward the losing side, you end up with fewer GIES than you started with —
                  <strong className="text-foreground"> even after collecting trading fees</strong>.
                </p>
                <p>
                  The key insight: impermanent loss is greatest when the price moves sharply in one direction.
                  It's "impermanent" because if the price returns to 50/50 before you withdraw, the loss disappears.
                  But if you withdraw while the market is skewed, the loss is realized.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Your LP Positions</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr className="border-b border-border">
                <Th>Market</Th>
                <Th className="text-right">LP Shares</Th>
                <Th className="text-right">Pool Share</Th>
                <Th className="text-right">Est. Value (GIES)</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {positions?.map((pos) => (
                <tr key={pos.marketId} className="border-b border-border/50">
                  <Td className="font-medium">{pos.marketTitle}</Td>
                  <Td className="text-right font-mono">{pos.lpShares.toFixed(2)}</Td>
                  <Td className="text-right font-mono">{formatProb(pos.poolShare)}</Td>
                  <Td className="text-right font-mono font-bold text-primary">{formatGies(pos.estimatedValue)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setRemoveModal({ isOpen: true, marketId: pos.marketId, maxShares: pos.lpShares })}>
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
              {positions?.length === 0 && (
                <tr><Td colSpan={5} className="text-center py-8 text-muted-foreground">No active liquidity positions.</Td></tr>
              )}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Available Pools</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr className="border-b border-border">
                <Th>Market</Th>
                <Th className="text-right">Total Liquidity</Th>
                <Th className="text-right">Current Prob</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {markets?.map((m) => (
                <tr key={m.id} className="border-b border-border/50">
                  <Td className="font-medium">{m.title}</Td>
                  <Td className="text-right font-mono">{formatGies(m.totalLiquidity)}</Td>
                  <Td className="text-right font-mono text-yes">{formatProb(m.yesPrice)} YES</Td>
                  <Td className="text-right">
                    <Button size="sm" onClick={() => setProvideModal({ isOpen: true, marketId: m.id })}>
                      Add Liquidity
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      {/* Provide Modal */}
      <Modal isOpen={provideModal.isOpen} onClose={() => { setProvideModal({ isOpen: false, marketId: null }); setAmount(""); }} title="Add Liquidity">
        <div className="space-y-4">
          {/* Impermanent loss warning */}
          <div className="flex gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
            <p className="text-sm text-yellow-700 dark:text-yellow-400 leading-relaxed">
              <strong>Heads up: Impermanent loss risk.</strong> Liquidity providers can experience impermanent loss if
              the market price shifts significantly after you deposit. You may receive less than your initial deposit
              upon withdrawal, even after collecting trading fees.{" "}
              <button
                className="underline font-medium"
                onClick={() => { setProvideModal({ isOpen: false, marketId: null }); setIlExpanded(true); setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50); }}
              >
                Learn more
              </button>
            </p>
          </div>
          <p className="text-sm text-muted-foreground">Enter the amount of GIES to add to the pool. You will receive LP shares representing your proportion of the pool.</p>
          <Input type="number" placeholder="GIES Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button className="w-full" onClick={handleProvide} isLoading={provideMutation.isPending}>Add Liquidity</Button>
        </div>
      </Modal>

      {/* Remove Modal */}
      <Modal isOpen={removeModal.isOpen} onClose={() => { setRemoveModal({ isOpen: false, marketId: null, maxShares: 0 }); setAmount(""); }} title="Remove Liquidity">
        <div className="space-y-4">
          {/* Impermanent loss warning */}
          <div className="flex gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
            <p className="text-sm text-yellow-700 dark:text-yellow-400 leading-relaxed">
              <strong>Heads up: Impermanent loss may apply.</strong> If market prices have moved since you deposited,
              the GIES you receive may be less than what you originally provided.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">Enter the number of LP shares to remove. Max: {removeModal.maxShares.toFixed(2)}</p>
          <Input type="number" placeholder="LP Shares" value={amount} onChange={(e) => setAmount(e.target.value)} max={removeModal.maxShares} />
          <Button className="w-full" variant="danger" onClick={handleRemove} isLoading={removeMutation.isPending}>Remove Liquidity</Button>
        </div>
      </Modal>

    </div>
  );
}
