import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from "@/components/ui";

export default function Settings() {
  const { user } = useAuth();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!oldPassword || !newPassword) {
      setError("Enter your current and new password.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (newPassword === oldPassword) {
      setError("New password must be different from your current one.");
      return;
    }

    setIsPending(true);
    try {
      const token = localStorage.getItem("ibpm_token");
      const resp = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((data as any)?.error || "Could not change password.");
      setSuccess("Password updated.");
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err: any) {
      setError(err.message || "Could not change password.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-xl">
      <h1 className="text-3xl font-display font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">NetID</dt>
            <dd className="col-span-2 font-mono">{user?.username}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="col-span-2">{user?.displayName}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="col-span-2">{user?.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="col-span-2 capitalize">{user?.role?.replace("_", " ")}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Change Password</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Current Password</label>
              <Input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">New Password</label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              <p className="text-xs text-muted-foreground mt-1">At least 8 characters.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Confirm New Password</label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-emerald-500">{success}</p>}
            <Button type="submit" className="w-full" isLoading={isPending}>Update Password</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
