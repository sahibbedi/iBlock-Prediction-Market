import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from "@/components/ui";

const templates: Record<string, { label: string; fields: Record<string, string | number | boolean | null> }> = {
  create_market: { label: "Create market", fields: { title: "", description: "", resolutionCriteria: "", initialLiquidity: 1000, category: "general" } },
  resolve_market: { label: "Resolve market", fields: { marketId: 1, outcome: "yes" } },
  close_market: { label: "Close market", fields: { marketId: 1 } },
  role: { label: "Appoint maker or change role", fields: { userId: 1, role: "market_maker" } },
  capital: { label: "Adjust maker capital", fields: { userId: 1, amount: 15000, clawback: false } },
  membership: { label: "Activate or revoke membership", fields: { userId: 1, active: true } },
  roster: { label: "Manage allowlist", fields: { email: "", displayName: "", active: true } },
  economics: { label: "Set economics", fields: { starterAmount: 5000, makerCapital: 15000, feeBase: 0.02, feeMax: 0.05, feeMatch: 1, rewardBudget: 20000 } },
  treasury: { label: "Fund treasury", fields: { amount: 10000 } },
  market_params: { label: "Set market safeguards", fields: { marketId: 1, maxPriceImpact: 0.15, minPoolDepth: 10, maxTradeSizePct: 0.25, feeBase: 0.02, feeMax: 0.05 } },
  reward: { label: "Pay LP reward", fields: { userId: 1, claimId: "", attributedFees: 1, evidence: "" } },
  thresholds: { label: "Set approval thresholds", fields: { routine: 2, resolve: 2 } },
  pause: { label: "Resume trading", fields: { paused: false } },
};
const label = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
export async function campusApi(path: string, body?: unknown) {
  const token = localStorage.getItem("ibpm_token");
  const response = await fetch(`/api${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export default function Committee() {
  const { user } = useAuth();
  const client = useQueryClient();
  const state = useQuery({ queryKey: ["committee"], queryFn: () => campusApi("/committee"), enabled: user?.role === "admin", refetchInterval: 15000 });
  const people = useQuery({ queryKey: ["people"], queryFn: () => campusApi("/users"), enabled: user?.role === "admin" });
  const roster = useQuery({ queryKey: ["roster"], queryFn: () => campusApi("/committee/roster"), enabled: user?.role === "admin" });
  const [type, setType] = useState("create_market");
  const [fields, setFields] = useState(templates.create_market.fields);
  const [message, setMessage] = useState("");
  const mutation = useMutation({ mutationFn: ({ path, body }: { path: string; body: unknown }) => campusApi(path, body), onSuccess: data => { setMessage(data.tempPassword ? `Temporary password for ${data.username}: ${data.tempPassword}${data.proposalId ? ` (requires committee approval of proposal #${data.proposalId})` : ""}` : data.status === "pending" ? "Proposal saved. Another committee member must approve it." : "Action completed."); client.invalidateQueries(); } });
  if (user?.role !== "admin") return <p>Committee access required.</p>;
  const config = state.data?.config;
  return <div className="space-y-8">
    <h1 className="text-3xl font-display font-bold">Admin committee</h1>
    <p className="text-muted-foreground">Makers are standing appointments. Capital remains with their desk until the committee adjusts it.</p>
    {(state.error || people.error || roster.error || mutation.error) && <p role="alert" className="text-destructive">{(state.error || people.error || roster.error || mutation.error)?.message}</p>}
    {message && <p role="status">{message}</p>}
    <Card><CardHeader><CardTitle>Platform</CardTitle></CardHeader><CardContent className="space-y-3">
      {config ? <p>{config.paused ? "New risk paused" : "Trading open"}. Routine approvals: {config.routineThreshold}. Sensitive approvals: {config.resolveThreshold}. Treasury: {Number(config.treasuryBalance).toLocaleString()} GIES. Reward budget remaining: {Number(config.rewardBudget).toLocaleString()} GIES.</p> : <p>Loading committee configuration...</p>}
      <p className="text-sm text-muted-foreground">{state.data?.members.map((m: any) => m.displayName).join(", ")}</p>
      <Button variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate({ path: "/committee/pause", body: {} })}>Pause new trading</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Propose an action</CardTitle></CardHeader><CardContent>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); setMessage(""); mutation.mutate({ path: "/committee/proposals", body: { type, ...fields } }); }}>
        <label className="block">Action<select aria-label="Action" className="block w-full p-3 mt-2 rounded-lg bg-background border border-border" value={type} onChange={e => { setType(e.target.value); setFields({ ...templates[e.target.value].fields }); }}>{Object.entries(templates).map(([key,t]) => <option key={key} value={key}>{t.label}</option>)}</select></label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{Object.entries(fields).map(([key,value]) => <label key={`${type}-${key}`} className="block text-sm space-y-2"><span>{label(key)}</span>{typeof value === "boolean" ? <select aria-label={label(key)} className="block p-3 rounded-lg bg-background border border-border" value={String(value)} onChange={e => setFields({ ...fields, [key]: e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select> : <Input aria-label={label(key)} required type={typeof templates[type].fields[key] === "number" ? "number" : "text"} step="any" value={String(value ?? "")} onChange={e => setFields({ ...fields, [key]: typeof templates[type].fields[key] === "number" ? Number(e.target.value) : e.target.value })} />}</label>)}</div>
        <p className="text-sm text-muted-foreground">Fee rates and caps use fractions: 0.02 = 2%. Fee match uses a multiplier: 1 = 100%. Reward evidence must identify the report and fee interval. Submitting records your first approval.</p>
        <Button type="submit" disabled={mutation.isPending}>Submit for approval</Button>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Committee proposals</CardTitle></CardHeader><CardContent className="space-y-4">
      {state.data?.proposals.length === 0 && <p>No proposals yet.</p>}
      {state.data?.proposals.map((p: any) => <article key={p.id} className="border border-border rounded-xl p-4 space-y-3">
        <p className="font-semibold">#{p.id} {templates[p.action.type]?.label || p.action.type} - {p.status}</p>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">{Object.entries(p.action).filter(([k]) => k !== "type" && k !== "passwordHash").map(([k,v]) => <div key={k}><dt className="text-muted-foreground">{label(k)}</dt><dd className="break-words">{String(v)}</dd></div>)}</dl>
        <p className="text-sm">Approvals: {p.approvals.join(", ")}. Expires {new Date(p.expiresAt).toLocaleString()}.</p>
        {p.status === "pending" && <Button disabled={mutation.isPending || p.approvals.includes(user.id) || p.version !== config?.version || new Date(p.expiresAt) < new Date()} onClick={() => mutation.mutate({ path: `/committee/proposals/${p.id}/approve`, body: {} })}>Approve this action</Button>}
      </article>)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>People</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">ID / Name</th><th>Role</th><th>Membership</th><th>Personal / Maker capital</th><th>Password</th></tr></thead><tbody>{people.data?.map((u: any) => <tr key={u.id}><td className="p-2">{u.id} / {u.displayName}</td><td>{u.role}</td><td>{u.active ? "Active" : "Revoked"}</td><td>{Number(u.giesBalance).toLocaleString()} / {Number(u.deskBalance).toLocaleString()}</td><td><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ path: `/users/${u.id}/reset-password`, body: {} })}>Reset password</Button></td></tr>)}</tbody></table></CardContent></Card>
    <Card><CardHeader><CardTitle>Allowlist</CardTitle></CardHeader><CardContent><ul className="space-y-2">{roster.data?.map((r: any) => <li key={r.id}>{r.displayName} ({r.email}) - {r.active ? "Active" : "Revoked"}{r.claimed ? ", registered" : ", awaiting registration"}</li>)}</ul></CardContent></Card>
  </div>;
}
