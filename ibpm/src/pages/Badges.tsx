import React, { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { formatDateTime, cn } from "@/lib/utils";
import { Lock } from "lucide-react";

interface Badge {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: "trading" | "community" | "advanced";
  earned: boolean;
  awardedAt: string | null;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("ibpm_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const CATEGORY_LABELS: Record<string, string> = {
  trading: "Trading",
  community: "Community",
  advanced: "Advanced",
};

const CATEGORY_ORDER = ["trading", "community", "advanced"];

export default function Badges() {
  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/badges/evaluate", {
        method: "POST",
        headers: getAuthHeaders(),
      });
      return res.json();
    },
  });

  const { data: badges = [], isLoading, refetch } = useQuery<Badge[]>({
    queryKey: ["badges", "me"],
    queryFn: async () => {
      const res = await fetch("/api/badges/me", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch badges");
      return res.json();
    },
  });

  useEffect(() => {
    evaluateMutation.mutateAsync().then(() => refetch());
  }, []);

  const earnedCount = badges.filter(b => b.earned).length;
  const totalCount = badges.length;

  const grouped = CATEGORY_ORDER.reduce<Record<string, Badge[]>>((acc, cat) => {
    acc[cat] = badges.filter(b => b.category === cat);
    return acc;
  }, {});

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Badges</h1>
          <p className="text-muted-foreground mt-1">
            Earn badges by trading, contributing ideas, and engaging with the community.
          </p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-display font-bold text-primary">{earnedCount}</p>
          <p className="text-sm text-muted-foreground">of {totalCount} earned</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-700 rounded-full"
          style={{ width: totalCount > 0 ? `${(earnedCount / totalCount) * 100}%` : "0%" }}
        />
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading badges...</div>
      ) : (
        CATEGORY_ORDER.map(cat => (
          <div key={cat}>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4 px-1">
              {CATEGORY_LABELS[cat]}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {grouped[cat].map(badge => (
                <Card
                  key={badge.id}
                  className={cn(
                    "transition-all",
                    badge.earned
                      ? "border-primary/20 bg-primary/5 shadow-sm shadow-primary/10"
                      : "opacity-50 grayscale"
                  )}
                >
                  <CardContent className="p-5 flex items-start gap-4">
                    <div className={cn(
                      "text-3xl w-12 h-12 flex items-center justify-center rounded-xl shrink-0",
                      badge.earned ? "bg-primary/10" : "bg-muted"
                    )}>
                      {badge.earned ? badge.emoji : <Lock className="w-5 h-5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{badge.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{badge.description}</p>
                      {badge.earned && badge.awardedAt && (
                        <p className="text-xs text-primary/70 font-mono mt-2">
                          Earned {formatDateTime(badge.awardedAt)}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
