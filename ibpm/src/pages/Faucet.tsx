import React from "react";
import { useClaimFaucet, useGetWalletBalance } from "@workspace/api-client-react";
import { withAuthHeaders } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@/components/ui";
import { Droplets, AlertCircle } from "lucide-react";
import { formatGies, formatDateTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

export default function Faucet() {
  const queryClient = useQueryClient();
  const { data: balance } = useGetWalletBalance(withAuthHeaders());
  const claimMutation = useClaimFaucet(withAuthHeaders());

  const handleClaim = async () => {
    try {
      await claimMutation.mutateAsync({});
      queryClient.invalidateQueries();
    } catch (e) {
      // Error handled in UI
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500 pt-8">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 bg-primary/10 text-primary rounded-3xl mx-auto flex items-center justify-center rotate-12 hover:rotate-0 transition-all duration-300">
          <Droplets className="w-10 h-10" />
        </div>
        <h1 className="text-4xl font-display font-bold">$GIES Faucet</h1>
        <p className="text-lg text-muted-foreground">Claim free simulated tokens to participate in the prediction market.</p>
      </div>

      <Card className="border-primary/20 shadow-2xl shadow-primary/5 text-center p-8">
        <CardContent className="space-y-6">
          <div className="bg-background rounded-2xl p-6 border border-border inline-block min-w-[250px]">
            <p className="text-sm font-medium text-muted-foreground mb-2">Current Balance</p>
            <h2 className="text-4xl font-mono font-bold text-primary">{formatGies(balance?.giesBalance)}</h2>
          </div>

          <div>
            <Button 
              size="lg" 
              className="w-full sm:w-auto px-12 text-lg h-16 shadow-xl shadow-primary/20"
              onClick={handleClaim}
              isLoading={claimMutation.isPending}
            >
              Claim $GIES Tokens
            </Button>
          </div>

          {claimMutation.isSuccess && (
            <div className="p-4 bg-success/10 text-success border border-success/20 rounded-xl font-medium">
              Successfully claimed {formatGies(claimMutation.data?.amount)}. New balance: {formatGies(claimMutation.data?.newBalance)}.
            </div>
          )}

          {claimMutation.isError && (
            <div className="p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-xl font-medium flex items-center justify-center gap-2">
              <AlertCircle className="w-5 h-5" />
              {(claimMutation.error as any)?.response?.data?.error || "Failed to claim faucet."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
