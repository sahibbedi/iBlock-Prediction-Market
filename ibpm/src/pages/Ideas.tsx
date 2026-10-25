import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, Badge, Button, Input, Modal } from "@/components/ui";
import { Lightbulb, ThumbsUp, CheckCircle, XCircle, Plus, ChevronDown } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";

interface Idea {
  id: number;
  title: string;
  description: string;
  category: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  submittedBy: number;
  submitterUsername: string;
  submitterDisplay: string;
  voteCount: number;
  userVoted: boolean;
  createdAt: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("ibpm_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const CATEGORIES = ["general", "finance", "economics", "crypto", "politics", "sports", "technology", "other"];

const STATUS_FILTER_OPTIONS = [
  { label: "All Ideas", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

export default function Ideas() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  const [statusFilter, setStatusFilter] = useState("");
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [submitError, setSubmitError] = useState("");

  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const { data: ideas = [], isLoading } = useQuery<Idea[]>({
    queryKey: ["ideas", statusFilter],
    queryFn: async () => {
      const params = statusFilter ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/ideas${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch ideas");
      return res.json();
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: { title: string; description: string; category: string }) => {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to submit idea");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ideas"] });
      setShowSubmitModal(false);
      setNewTitle("");
      setNewDescription("");
      setNewCategory("general");
      setSubmitError("");
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  const voteMutation = useMutation({
    mutationFn: async (ideaId: number) => {
      const res = await fetch(`/api/ideas/${ideaId}/vote`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to vote");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ideas"] }),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ ideaId, status, note }: { ideaId: number; status: string; note: string }) => {
      const res = await fetch(`/api/ideas/${ideaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ status, reviewNote: note }),
      });
      if (!res.ok) throw new Error("Failed to update idea");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ideas"] });
      setReviewingId(null);
      setReviewNote("");
    },
  });

  const handleSubmit = () => {
    if (!newTitle.trim()) { setSubmitError("Title is required"); return; }
    if (!newDescription.trim()) { setSubmitError("Description is required"); return; }
    submitMutation.mutate({ title: newTitle, description: newDescription, category: newCategory });
  };

  const handleReview = (ideaId: number, status: "approved" | "rejected") => {
    reviewMutation.mutate({ ideaId, status, note: reviewNote });
  };

  const statusBadge = (status: string) => {
    if (status === "approved") return <Badge variant="success">Approved</Badge>;
    if (status === "rejected") return <Badge variant="error">Rejected</Badge>;
    return <Badge variant="warning">Pending</Badge>;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-bold">Market Ideas</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Suggest prediction markets for your class to trade on. Vote for the ideas you want to see.
          </p>
        </div>
        <Button disabled={user?.role !== "trader" && user?.role !== "market_maker"} onClick={() => setShowSubmitModal(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Suggest an Idea
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-card border border-border rounded-xl w-fit">
        {STATUS_FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
              statusFilter === opt.value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Ideas list */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading ideas...</div>
      ) : ideas.length === 0 ? (
        <div className="text-center py-16">
          <Lightbulb className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">No ideas yet</p>
          <p className="text-muted-foreground text-sm mt-1">Be the first to suggest a market!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ideas.map(idea => (
            <Card key={idea.id} className={cn(
              "transition-all",
              idea.status === "approved" && "border-yes/30 bg-yes/5",
              idea.status === "rejected" && "opacity-60"
            )}>
              <CardContent className="p-5">
                <div className="flex gap-4">
                  {/* Vote button */}
                  <button
                    onClick={() => voteMutation.mutate(idea.id)}
                    disabled={voteMutation.isPending || !["trader", "market_maker"].includes(user?.role || "")}
                    className={cn(
                      "flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-all shrink-0",
                      idea.userVoted
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/30 hover:text-primary"
                    )}
                  >
                    <ThumbsUp className={cn("w-4 h-4", idea.userVoted && "fill-current")} />
                    <span className="text-sm font-bold font-mono">{idea.voteCount}</span>
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base leading-snug">{idea.title}</h3>
                      <Badge variant="outline" className="text-xs capitalize">{idea.category}</Badge>
                      {statusBadge(idea.status)}
                    </div>

                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">{idea.description}</p>

                    {idea.reviewNote && (
                      <p className="text-xs text-muted-foreground italic mb-2 border-l-2 border-border pl-3">
                        Review note: {idea.reviewNote}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-muted-foreground font-mono">
                        by {idea.submitterDisplay} · {formatDateTime(idea.createdAt)}
                      </span>

                      {/* Teacher approve/reject — only on pending */}
                      {isAdmin && idea.status === "pending" && (
                        <div className="flex items-center gap-2">
                          {reviewingId === idea.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder="Optional note..."
                                value={reviewNote}
                                onChange={e => setReviewNote(e.target.value)}
                                className="h-7 text-xs w-40"
                              />
                              <button
                                onClick={() => handleReview(idea.id, "approved")}
                                disabled={reviewMutation.isPending}
                                className="flex items-center gap-1 text-xs font-medium text-yes hover:text-yes/80 transition-colors"
                              >
                                <CheckCircle className="w-4 h-4" /> Approve
                              </button>
                              <button
                                onClick={() => handleReview(idea.id, "rejected")}
                                disabled={reviewMutation.isPending}
                                className="flex items-center gap-1 text-xs font-medium text-destructive hover:text-destructive/80 transition-colors"
                              >
                                <XCircle className="w-4 h-4" /> Reject
                              </button>
                              <button
                                onClick={() => { setReviewingId(null); setReviewNote(""); }}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setReviewingId(idea.id)}
                              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                            >
                              <ChevronDown className="w-3 h-3" /> Review
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Submit Modal */}
      <Modal isOpen={showSubmitModal} onClose={() => { setShowSubmitModal(false); setSubmitError(""); }} title="Suggest a Market Idea">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Propose a prediction market for your class. Teachers review top-voted ideas and can publish them.
          </p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Market Question <span className="text-destructive">*</span></label>
            <Input
              placeholder='e.g. "Will the Fed cut rates before June 2026?"'
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground text-right">{newTitle.length}/120</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Why is this interesting? <span className="text-destructive">*</span></label>
            <textarea
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              rows={3}
              placeholder="Explain what makes this market educationally relevant, how it should resolve, and any data sources..."
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground text-right">{newDescription.length}/1000</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Category</label>
            <select
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={newCategory}
              onChange={e => setNewCategory(e.target.value)}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>

          {submitError && (
            <p className="text-destructive text-sm">{submitError}</p>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => { setShowSubmitModal(false); setSubmitError(""); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} isLoading={submitMutation.isPending}>
              Submit Idea
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
