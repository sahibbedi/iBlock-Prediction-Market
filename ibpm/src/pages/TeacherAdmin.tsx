import React, { useState, useEffect, useCallback } from "react";
import { useAuth, withAuthHeaders } from "@/contexts/AuthContext";
import { useCreateMarket, useListMarkets, useCloseMarket, useResolveMarket, useUpdateMarketSafeguards } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Table, Th, Td, Badge, Modal } from "@/components/ui";

// ---- Raw fetch helper (people/rotation endpoints have no generated hooks) -----
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("ibpm_token");
  return {
    "content-type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options?.headers || {}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as any)?.error || `Request failed (${resp.status})`);
  return data as T;
}

interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  role: string;
  cohortId: number | null;
  rotationGroup: number | null;
  giesBalance: number;
  deskBalance: number;
  createdAt: string;
}

export default function TeacherAdmin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: markets } = useListMarkets({}, withAuthHeaders());
  const createMutation = useCreateMarket(withAuthHeaders());
  const closeMutation = useCloseMarket(withAuthHeaders());
  const resolveMutation = useResolveMarket(withAuthHeaders());
  const safeguardsMutation = useUpdateMarketSafeguards(withAuthHeaders());

  const [createModal, setCreateModal] = useState(false);
  const [resolveModal, setResolveModal] = useState<{isOpen: boolean, marketId: number | null}>({isOpen: false, marketId: null});
  const [safeguardModal, setSafeguardModal] = useState<{isOpen: boolean, marketId: number | null, title: string}>({isOpen: false, marketId: null, title: ""});

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resolutionCriteria, setResolutionCriteria] = useState("");
  const [learningPanel, setLearningPanel] = useState("");
  const [category, setCategory] = useState("Finance");
  const [liq, setLiq] = useState("1000");
  const [maxPriceImpact, setMaxPriceImpact] = useState("15");
  const [minPoolDepth, setMinPoolDepth] = useState("10");
  const [maxTradeSizePct, setMaxTradeSizePct] = useState("25");
  const [virtualLiquidity, setVirtualLiquidity] = useState("400");
  const [virtualLiquidityDecayVolume, setVirtualLiquidityDecayVolume] = useState("1000");
  const [createError, setCreateError] = useState("");

  const [sgMaxImpact, setSgMaxImpact] = useState("15");
  const [sgMinDepth, setSgMinDepth] = useState("10");
  const [sgMaxSize, setSgMaxSize] = useState("25");
  const [sgVirtualLiquidity, setSgVirtualLiquidity] = useState("0");
  const [sgVirtualLiquidityDecayVolume, setSgVirtualLiquidityDecayVolume] = useState("1000");
  const [sgError, setSgError] = useState("");

  // ---- People / rotation state ----
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [search, setSearch] = useState("");

  const [rotationModal, setRotationModal] = useState<{ isOpen: boolean; group: number | null }>({ isOpen: false, group: null });
  const [rotationBusy, setRotationBusy] = useState(false);
  const [rotationMsg, setRotationMsg] = useState("");
  const [rotationErr, setRotationErr] = useState("");

  const [resetModal, setResetModal] = useState<{ isOpen: boolean; u: AdminUser | null }>({ isOpen: false, u: null });
  const [resetBusy, setResetBusy] = useState(false);
  const [resetResult, setResetResult] = useState<{ username: string; tempPassword: string } | null>(null);
  const [resetErr, setResetErr] = useState("");

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const data = await apiFetch<AdminUser[]>("/api/users");
      setUsers(data);
    } catch (e: any) {
      setUsersError(e.message || "Failed to load users.");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === "teacher" || user?.role === "admin") loadUsers();
  }, [user?.role, loadUsers]);

  if (user?.role !== "teacher" && user?.role !== "admin") {
    return <div className="p-8 text-center text-destructive">Access Denied. Teacher/Admin only.</div>;
  }

  // Current active maker group = the group of users currently holding the maker role.
  const activeGroups = Array.from(
    new Set(users.filter((u) => u.role === "market_maker" && u.rotationGroup != null).map((u) => u.rotationGroup))
  ).sort();
  const makerCount = users.filter((u) => u.role === "market_maker").length;

  const groupSize = (g: number) => users.filter((u) => u.rotationGroup === g).length;

  const handleActivateRotation = async () => {
    if (rotationModal.group == null) return;
    setRotationBusy(true);
    setRotationErr("");
    setRotationMsg("");
    try {
      const r = await apiFetch<{ activeGroup: number; marketMakers: number; settledToStudent: number; deskCapital: number }>(
        "/api/users/rotation/activate",
        { method: "POST", body: JSON.stringify({ group: rotationModal.group }) }
      );
      setRotationMsg(
        `Group ${r.activeGroup} activated: ${r.marketMakers} makers granted ${r.deskCapital.toLocaleString()} GIES desks; ${r.settledToStudent} settled back to student.`
      );
      setRotationModal({ isOpen: false, group: null });
      await loadUsers();
      queryClient.invalidateQueries();
    } catch (e: any) {
      setRotationErr(e.message || "Rotation failed.");
    } finally {
      setRotationBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetModal.u) return;
    setResetBusy(true);
    setResetErr("");
    try {
      const r = await apiFetch<{ username: string; tempPassword: string }>(
        `/api/users/${resetModal.u.id}/reset-password`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setResetResult({ username: r.username, tempPassword: r.tempPassword });
    } catch (e: any) {
      setResetErr(e.message || "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!title.trim() || !description.trim() || !resolutionCriteria.trim()) {
      setCreateError("Title, description, and resolution criteria are all required.");
      return;
    }
    const impactVal = parseFloat(maxPriceImpact);
    const depthVal = parseFloat(minPoolDepth);
    const sizeVal = parseFloat(maxTradeSizePct);
    if (isNaN(impactVal) || impactVal <= 0 || impactVal > 100) {
      setCreateError("Max price impact must be between 1 and 100.");
      return;
    }
    if (isNaN(depthVal) || depthVal <= 0) {
      setCreateError("Min pool depth must be a positive number.");
      return;
    }
    if (isNaN(sizeVal) || sizeVal <= 0 || sizeVal > 100) {
      setCreateError("Max trade size must be between 1 and 100.");
      return;
    }
    setCreateError("");
    try {
      await createMutation.mutateAsync({
        data: {
          title,
          description,
          resolutionCriteria,
          learningPanel: learningPanel || undefined,
          category,
          initialLiquidity: parseFloat(liq),
          maxPriceImpact: impactVal / 100,
          minPoolDepth: depthVal,
          maxTradeSizePct: sizeVal / 100,
          virtualLiquidity: parseFloat(virtualLiquidity) || 0,
          virtualLiquidityDecayVolume: parseFloat(virtualLiquidityDecayVolume) || 1000,
        } as any
      });
      setCreateModal(false);
      setTitle("");
      setDescription("");
      setResolutionCriteria("");
      setLearningPanel("");
      setCategory("Finance");
      setLiq("1000");
      setMaxPriceImpact("15");
      setMinPoolDepth("10");
      setMaxTradeSizePct("25");
      setVirtualLiquidity("400");
      setVirtualLiquidityDecayVolume("1000");
      queryClient.invalidateQueries();
    } catch (e) {}
  };

  const handleClose = async (id: number) => {
    try {
      await closeMutation.mutateAsync({ marketId: id });
      queryClient.invalidateQueries();
    } catch (e) {}
  };

  const handleResolve = async (outcome: "yes" | "no") => {
    if (!resolveModal.marketId) return;
    try {
      await resolveMutation.mutateAsync({ marketId: resolveModal.marketId, data: { outcome } });
      setResolveModal({ isOpen: false, marketId: null });
      queryClient.invalidateQueries();
    } catch (e) {}
  };

  const openSafeguardModal = (marketId: number, marketTitle: string) => {
    const m = markets?.find(x => x.id === marketId);
    if (m) {
      setSgMaxImpact(((m.maxPriceImpact ?? 0.15) * 100).toFixed(0));
      setSgMinDepth((m.minPoolDepth ?? 10).toFixed(0));
      setSgMaxSize(((m.maxTradeSizePct ?? 0.25) * 100).toFixed(0));
      setSgVirtualLiquidity(((m as any).virtualLiquidity ?? 0).toString());
      setSgVirtualLiquidityDecayVolume(((m as any).virtualLiquidityDecayVolume ?? 1000).toString());
    }
    setSafeguardModal({ isOpen: true, marketId, title: marketTitle });
    setSgError("");
  };

  const handleSaveSafeguards = async () => {
    if (!safeguardModal.marketId) return;
    const impactVal = parseFloat(sgMaxImpact);
    const depthVal = parseFloat(sgMinDepth);
    const sizeVal = parseFloat(sgMaxSize);
    if (isNaN(impactVal) || impactVal <= 0 || impactVal > 100) {
      setSgError("Max price impact must be between 1 and 100.");
      return;
    }
    if (isNaN(depthVal) || depthVal <= 0) {
      setSgError("Min pool depth must be a positive number.");
      return;
    }
    if (isNaN(sizeVal) || sizeVal <= 0 || sizeVal > 100) {
      setSgError("Max trade size must be between 1 and 100.");
      return;
    }
    setSgError("");
    try {
      await safeguardsMutation.mutateAsync({
        marketId: safeguardModal.marketId,
        data: {
          maxPriceImpact: impactVal / 100,
          minPoolDepth: depthVal,
          maxTradeSizePct: sizeVal / 100,
          virtualLiquidity: parseFloat(sgVirtualLiquidity) || 0,
          virtualLiquidityDecayVolume: parseFloat(sgVirtualLiquidityDecayVolume) || 1000,
        } as any,
      });
      setSafeguardModal({ isOpen: false, marketId: null, title: "" });
      queryClient.invalidateQueries();
    } catch (e) {
      setSgError("Failed to save safeguards.");
    }
  };

  const filteredUsers = users
    .filter((u) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.username.localeCompare(b.username));

  const roleBadge = (role: string) =>
    role === "market_maker" ? "success" : role === "teacher" || role === "admin" ? "warning" : "default";

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-display font-bold">Teacher Dashboard</h1>
        <Button onClick={() => setCreateModal(true)}>Create Market</Button>
      </div>

      {/* ---- Rotation Control ---- */}
      <Card>
        <CardHeader><CardTitle>Rotation Control</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Activating a group promotes its students to <span className="font-medium text-foreground">market makers</span> and grants each a fresh
            15,000 GIES desk. Every maker <span className="font-medium text-foreground">not</span> in the chosen group is settled back to student
            (open LP force-withdrawn, desk P&amp;L recorded for grading, desk zeroed). Personal balances are never touched.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Currently active:{" "}
              {activeGroups.length > 0
                ? <span className="font-semibold text-foreground">Group {activeGroups.join(", ")} ({makerCount} makers)</span>
                : <span className="font-semibold text-foreground">none</span>}
            </span>
            <div className="flex gap-2 ml-auto">
              {[1, 2, 3].map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant={activeGroups.includes(g) ? "outline" : "default"}
                  onClick={() => { setRotationMsg(""); setRotationErr(""); setRotationModal({ isOpen: true, group: g }); }}
                >
                  Activate Group {g} ({groupSize(g)})
                </Button>
              ))}
            </div>
          </div>
          {rotationMsg && <p className="text-sm text-emerald-500 mt-3">{rotationMsg}</p>}
          {rotationErr && <p className="text-sm text-destructive mt-3">{rotationErr}</p>}
        </CardContent>
      </Card>

      {/* ---- People ---- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>People ({users.length})</CardTitle>
            <div className="flex items-center gap-2">
              <Input placeholder="Search name / netid / email" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
              <Button size="sm" variant="outline" onClick={loadUsers} isLoading={usersLoading}>Refresh</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {usersError && <p className="text-sm text-destructive mb-3">{usersError}</p>}
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr className="border-b border-border">
                  <Th>NetID</Th>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Group</Th>
                  <Th>Personal</Th>
                  <Th>Desk</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-border/50">
                    <Td className="font-mono">{u.username}</Td>
                    <Td className="font-medium max-w-[200px] truncate">{u.displayName}</Td>
                    <Td><Badge variant={roleBadge(u.role) as any}>{u.role.replace("_", " ")}</Badge></Td>
                    <Td className="text-muted-foreground">{u.rotationGroup ?? "—"}</Td>
                    <Td className="font-mono">{u.giesBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Td>
                    <Td className="font-mono">{u.deskBalance > 0 ? u.deskBalance.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setResetResult(null); setResetErr(""); setResetModal({ isOpen: true, u }); }}
                      >
                        Reset Password
                      </Button>
                    </Td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && !usersLoading && (
                  <tr><Td colSpan={7} className="text-center text-muted-foreground py-6">No users found.</Td></tr>
                )}
              </tbody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Manage Markets</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr className="border-b border-border">
                <Th>ID</Th>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {markets?.map(m => (
                <tr key={m.id} className="border-b border-border/50">
                  <Td className="font-mono text-muted-foreground">#{m.id}</Td>
                  <Td className="font-medium max-w-md truncate">{m.title}</Td>
                  <Td>
                    <Badge variant={m.status === 'open' ? 'success' : m.status === 'closed' ? 'warning' : 'default'}>
                      {m.status.toUpperCase()}
                    </Badge>
                  </Td>
                  <Td className="space-x-2">
                    {m.status === 'open' && (
                      <Button size="sm" variant="danger" onClick={() => handleClose(m.id)} isLoading={closeMutation.isPending}>Close Trading</Button>
                    )}
                    {(m.status === 'open' || m.status === 'closed') && (
                      <Button size="sm" onClick={() => setResolveModal({isOpen: true, marketId: m.id})}>Resolve</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openSafeguardModal(m.id, m.title)}>Safeguards</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      {/* Rotation confirm modal */}
      <Modal isOpen={rotationModal.isOpen} onClose={() => setRotationModal({ isOpen: false, group: null })} title={`Activate Group ${rotationModal.group ?? ""}?`}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This will promote the <span className="font-medium text-foreground">{rotationModal.group != null ? groupSize(rotationModal.group) : 0} students</span> in
            Group {rotationModal.group} to market makers and grant each a fresh 15,000 GIES desk.
          </p>
          <p className="text-sm text-muted-foreground">
            All current makers outside Group {rotationModal.group} will be <span className="font-medium text-destructive">settled and demoted</span>: their open
            liquidity is force-withdrawn, desk P&amp;L is recorded for grading, and their desk is zeroed. This is how a cycle ends — run it at the cycle boundary.
          </p>
          {rotationErr && <p className="text-sm text-destructive">{rotationErr}</p>}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setRotationModal({ isOpen: false, group: null })}>Cancel</Button>
            <Button className="flex-1" onClick={handleActivateRotation} isLoading={rotationBusy}>Activate Group {rotationModal.group}</Button>
          </div>
        </div>
      </Modal>

      {/* Reset password modal */}
      <Modal isOpen={resetModal.isOpen} onClose={() => setResetModal({ isOpen: false, u: null })} title="Reset Password">
        <div className="space-y-4">
          {!resetResult ? (
            <>
              <p className="text-sm text-muted-foreground">
                Generate a new temporary password for <span className="font-medium text-foreground">{resetModal.u?.displayName}</span> ({resetModal.u?.username}).
                Their current password stops working immediately. Give them the temp password and have them change it after logging in.
              </p>
              {resetErr && <p className="text-sm text-destructive">{resetErr}</p>}
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setResetModal({ isOpen: false, u: null })}>Cancel</Button>
                <Button className="flex-1" variant="danger" onClick={handleResetPassword} isLoading={resetBusy}>Generate Temp Password</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Temporary password for <span className="font-medium text-foreground">{resetResult.username}</span>. Copy it now — it won't be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm select-all">{resetResult.tempPassword}</code>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(resetResult.tempPassword)}>Copy</Button>
              </div>
              <Button className="w-full" onClick={() => setResetModal({ isOpen: false, u: null })}>Done</Button>
            </>
          )}
        </div>
      </Modal>

      {/* Create Market Modal */}
      <Modal isOpen={createModal} onClose={() => { setCreateModal(false); setCreateError(""); }} title="Create New Market">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Market Title <span className="text-destructive">*</span></label>
            <Input placeholder="e.g. Will the 10-year Treasury yield exceed 5% by Q3?" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Description <span className="text-destructive">*</span></label>
            <Input placeholder="Brief context about what this market is predicting" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Resolution Criteria <span className="text-destructive">*</span></label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[80px] resize-y"
              placeholder="Explain exactly what event resolves this market YES or NO, the data source used (e.g. U.S. Treasury website), the resolution date, and how edge cases are handled."
              value={resolutionCriteria}
              onChange={(e) => setResolutionCriteria(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Learning Panel <span className="text-xs text-muted-foreground/60">(optional)</span>
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[80px] resize-y"
              placeholder="Plain-language explanation of the underlying concept. Students will see this as a collapsible panel."
              value={learningPanel}
              onChange={(e) => setLearningPanel(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Category</label>
            <Input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Initial Liquidity (GIES) <span className="text-destructive">*</span></label>
            <Input type="number" placeholder="Initial Liquidity (GIES)" value={liq} onChange={(e) => setLiq(e.target.value)} />
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold mb-3">Manipulation Safeguards</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Max Price Impact (%)</label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="15"
                  value={maxPriceImpact}
                  onChange={(e) => setMaxPriceImpact(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Default: 15%</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Min Pool Depth (GIES)</label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="10"
                  value={minPoolDepth}
                  onChange={(e) => setMinPoolDepth(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Default: 10</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Max Trade Size (%)</label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="25"
                  value={maxTradeSizePct}
                  onChange={(e) => setMaxTradeSizePct(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Default: 25%</p>
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold mb-1">Liquidity Bootstrapping <span className="text-xs text-muted-foreground font-normal">(optional)</span></p>
            <p className="text-xs text-muted-foreground mb-3">Adds virtual depth so early trades move the price less. Virtual depth decays to zero as real volume builds.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Virtual Liquidity (GIES)</label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  placeholder="400"
                  value={virtualLiquidity}
                  onChange={(e) => setVirtualLiquidity(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Simulated depth at open. Default: 400</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Decay Volume (GIES)</label>
                <Input
                  type="number"
                  min="1"
                  step="100"
                  placeholder="1000"
                  value={virtualLiquidityDecayVolume}
                  onChange={(e) => setVirtualLiquidityDecayVolume(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Volume at which virtual depth reaches zero. Default: 1000</p>
              </div>
            </div>
          </div>

          {createError && (
            <p className="text-sm text-destructive">{createError}</p>
          )}
          <Button className="w-full" onClick={handleCreate} isLoading={createMutation.isPending}>Deploy Market</Button>
        </div>
      </Modal>

      {/* Safeguards Edit Modal */}
      <Modal isOpen={safeguardModal.isOpen} onClose={() => setSafeguardModal({ isOpen: false, marketId: null, title: "" })} title="Edit Safeguards">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Configure manipulation safeguards for: <span className="font-medium text-foreground">{safeguardModal.title}</span></p>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Max Price Impact (%)</label>
              <Input
                type="number"
                min="1"
                max="100"
                step="1"
                value={sgMaxImpact}
                onChange={(e) => setSgMaxImpact(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Trades exceeding this price impact will be blocked.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Minimum Pool Depth (GIES)</label>
              <Input
                type="number"
                min="0"
                step="1"
                value={sgMinDepth}
                onChange={(e) => setSgMinDepth(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Trades that would reduce either pool below this floor are blocked.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Max Single Trade Size (% of pool)</label>
              <Input
                type="number"
                min="1"
                max="100"
                step="1"
                value={sgMaxSize}
                onChange={(e) => setSgMaxSize(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Single trades larger than this percentage of the total pool are blocked.</p>
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold mb-1">Liquidity Bootstrapping</p>
            <p className="text-xs text-muted-foreground mb-3">Adjust virtual depth to reduce price impact for early trades. Set Virtual Liquidity to 0 to disable bootstrapping entirely.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Virtual Liquidity (GIES)</label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  value={sgVirtualLiquidity}
                  onChange={(e) => setSgVirtualLiquidity(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Simulated pool depth at open (0 = off).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Decay Volume (GIES)</label>
                <Input
                  type="number"
                  min="1"
                  step="100"
                  value={sgVirtualLiquidityDecayVolume}
                  onChange={(e) => setSgVirtualLiquidityDecayVolume(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Volume at which virtual depth reaches zero.</p>
              </div>
            </div>
          </div>
          {sgError && <p className="text-sm text-destructive">{sgError}</p>}
          <Button className="w-full" onClick={handleSaveSafeguards} isLoading={safeguardsMutation.isPending}>Save Settings</Button>
        </div>
      </Modal>

      {/* Resolve Market Modal */}
      <Modal isOpen={resolveModal.isOpen} onClose={() => setResolveModal({isOpen: false, marketId: null})} title="Resolve Market">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground mb-4">Resolving a market pays out 1 GIES per correct token and 0 GIES per incorrect token. This action is irreversible.</p>
          <div className="flex gap-4">
            <Button className="flex-1" variant="yes" onClick={() => handleResolve("yes")} isLoading={resolveMutation.isPending}>Resolve YES</Button>
            <Button className="flex-1" variant="no" onClick={() => handleResolve("no")} isLoading={resolveMutation.isPending}>Resolve NO</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
