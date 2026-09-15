import React, { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Input, Card, CardHeader, CardTitle, CardContent } from "@/components/ui";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setIsPending(true);
    try {
      const resp = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || "Registration failed.");
      }
      login(data.token);
      setLocation("/dashboard");
    } catch (err: any) {
      setError(err?.message || "Registration failed. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      <img
        src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
        alt="Abstract Trading Background"
        className="absolute inset-0 w-full h-full object-cover opacity-20"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />

      <div className="relative z-10 w-full max-w-md p-4">
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-primary items-center justify-center font-display font-bold text-3xl text-primary-foreground shadow-2xl shadow-primary/30 mb-4">
            i
          </div>
          <h1 className="text-3xl font-display font-bold tracking-tight">iBlock Prediction Market</h1>
          <p className="text-muted-foreground mt-2">Derivatives & Trading Academy Simulation</p>
        </div>

        <Card className="backdrop-blur-xl bg-card/60 border-border/50 shadow-2xl">
          <CardHeader>
            <CardTitle>Create your account</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Illinois Email</label>
                <Input
                  type="email"
                  placeholder="netid@illinois.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Use the @illinois.edu email on the class roster. Your username will be your NetID.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Password</label>
                <Input
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Confirm Password</label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full mt-4" size="lg" isLoading={isPending}>
                Create Account
              </Button>
            </form>

            <p className="text-sm text-muted-foreground text-center mt-6">
              Already have an account?{" "}
              <Link href="/" className="text-primary font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
