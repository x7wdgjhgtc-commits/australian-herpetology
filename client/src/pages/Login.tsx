import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const user = await login(identifier, password);
      toast({ title: `Welcome back, ${user.displayName || user.username}` });
      setLocation(`/u/${user.username}`);
    } catch (err: any) {
      toast({
        title: "Login failed",
        description: err?.message || "Check your email or username and password.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-serif text-xl font-semibold mb-2">Log in</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Welcome back. Log records, follow other naturalists, and help ID their finds.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="identifier">Email or username</Label>
          <Input
            id="identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoComplete="username"
            placeholder="you@example.com or yourname"
            data-testid="input-email"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            data-testid="input-password"
          />
        </div>
        <Button type="submit" disabled={submitting} className="w-full" data-testid="button-login">
          {submitting ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <div className="text-sm text-muted-foreground mt-6 text-center">
        No account?{" "}
        <Link href="/signup" className="text-primary underline" data-testid="link-signup">
          Sign up
        </Link>
      </div>
    </div>
  );
}
