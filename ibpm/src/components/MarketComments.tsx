import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@/components/ui";
import { Trash2, MessageSquare, Loader2 } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";

interface Comment {
  id: number;
  marketId: number;
  userId: number;
  username: string;
  displayName: string;
  text: string;
  createdAt: string;
  positionLabel: string;
}

const PAGE_SIZE = 20;

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("ibpm_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchComments(marketId: number, offset: number): Promise<Comment[]> {
  const res = await fetch(`/api/markets/${marketId}/comments?limit=${PAGE_SIZE}&offset=${offset}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch comments");
  return res.json();
}

async function postComment(marketId: number, text: string): Promise<Comment> {
  const res = await fetch(`/api/markets/${marketId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to post comment");
  }
  return res.json();
}

async function deleteComment(commentId: number): Promise<void> {
  const res = await fetch(`/api/comments/${commentId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete comment");
  }
}

function positionBadgeStyle(label: string): string {
  if (label.includes("YES")) return "bg-yes/10 text-yes border border-yes/30";
  if (label.includes("NO")) return "bg-no/10 text-no border border-no/30";
  return "bg-muted text-muted-foreground border border-border";
}

interface MarketCommentsProps {
  marketId: number;
}

export default function MarketComments({ marketId }: MarketCommentsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [extraComments, setExtraComments] = useState<Comment[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const commentsQueryKey = ["comments", marketId];

  const { data: firstPage, isLoading } = useQuery({
    queryKey: commentsQueryKey,
    queryFn: () => fetchComments(marketId, 0),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  useEffect(() => {
    if (!firstPage) return;
    setExtraComments(prev => {
      if (prev.length === 0) {
        setHasMore(firstPage.length === PAGE_SIZE);
        return [];
      }
      const firstPageIds = new Set(firstPage.map(c => c.id));
      const dedupedExtra = prev.filter(c => !firstPageIds.has(c.id));
      return dedupedExtra;
    });
    setOffset(prev => Math.max(prev, firstPage.length));
    if (extraComments.length === 0) {
      setHasMore(firstPage.length === PAGE_SIZE);
    }
  }, [firstPage]);

  const allComments: Comment[] = [...(firstPage ?? []), ...extraComments];

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const more = await fetchComments(marketId, offset);
      setExtraComments(prev => [...prev, ...more]);
      setOffset(prev => prev + more.length);
      setHasMore(more.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [marketId, offset]);

  const postMutation = useMutation({
    mutationFn: (commentText: string) => postComment(marketId, commentText),
    onMutate: async (commentText) => {
      await queryClient.cancelQueries({ queryKey: commentsQueryKey });
      const previousData = queryClient.getQueryData<Comment[]>(commentsQueryKey);

      const optimisticComment: Comment = {
        id: -Date.now(),
        marketId,
        userId: user?.id ?? -1,
        username: user?.username ?? "",
        displayName: user?.displayName ?? user?.username ?? "",
        text: commentText,
        createdAt: new Date().toISOString(),
        positionLabel: "No position",
      };

      queryClient.setQueryData<Comment[]>(commentsQueryKey, (old = []) => [
        optimisticComment,
        ...old,
      ]);

      return { previousData };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(commentsQueryKey, context.previousData);
      }
    },
    onSuccess: (serverComment) => {
      queryClient.setQueryData<Comment[]>(commentsQueryKey, (old = []) =>
        old.map(c => (c.id < 0 ? serverComment : c))
      );
      setText("");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: commentsQueryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteComment,
    onSuccess: (_, commentId) => {
      queryClient.setQueryData<Comment[]>(commentsQueryKey, (old = []) =>
        old.filter(c => c.id !== commentId)
      );
      setExtraComments(prev => prev.filter(c => c.id !== commentId));
      setDeleteConfirm(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || postMutation.isPending) return;
    postMutation.mutate(text.trim());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          Discussion
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {user && ["trader", "market_maker"].includes(user.role) ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Share your analysis or prediction..."
              rows={3}
              maxLength={1000}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{text.length}/1000</span>
              <div className="flex items-center gap-3">
                {postMutation.isError && (
                  <span className="text-xs text-destructive">
                    {(postMutation.error as Error)?.message || "Failed to post"}
                  </span>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={!text.trim() || postMutation.isPending}
                  isLoading={postMutation.isPending}
                >
                  Post Comment
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-border bg-muted/30 px-5 py-4 text-center text-sm text-muted-foreground">
            <a href="/login" className="text-primary hover:underline font-medium">Log in</a>
            {" "}to join the discussion.
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : allComments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No comments yet. Be the first to share your analysis!
          </div>
        ) : (
          <div className="space-y-4">
            {allComments.map(comment => {
              const isOwner = user?.id === comment.userId;
              const isPrivileged = user?.role === "admin";
              const canDelete = isOwner || isPrivileged;
              const isOptimistic = comment.id < 0;

              return (
                <div key={comment.id} className={cn("flex gap-3 group", isOptimistic && "opacity-60")}>
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm select-none">
                    {comment.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm">{comment.displayName || comment.username}</span>
                      <span
                        className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          positionBadgeStyle(comment.positionLabel)
                        )}
                      >
                        {comment.positionLabel}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {isOptimistic ? "posting…" : formatDateTime(comment.createdAt)}
                      </span>
                      {canDelete && !isOptimistic && (
                        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                          {deleteConfirm === comment.id ? (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground">Delete?</span>
                              <button
                                onClick={() => deleteMutation.mutate(comment.id)}
                                disabled={deleteMutation.isPending}
                                className="text-destructive font-medium hover:underline"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-muted-foreground hover:underline"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(comment.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                              title="Delete comment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-foreground/90 break-words">
                      {comment.text}
                    </p>
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <div className="text-center pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                  isLoading={loadingMore}
                >
                  Load more comments
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
