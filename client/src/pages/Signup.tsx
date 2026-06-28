import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiConnectInat } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Signup() {
  const { signup } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inatUsername, setInatUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const user = await signup({
        username,
        email,
        password,
        displayName: displayName || username,
      });
      toast({ title: `Welcome, ${user.displayName || user.username}` });

      // Optionally link iNaturalist account if the user supplied a handle.
      const inat = inatUsername.trim().replace(/^@/, "");
      if (inat) {
        try {
          const result = await apiConnectInat(inat);
          toast({
            title: "iNaturalist connected",
            description: `Imported ${result.summary.imported} record${
              result.summary.imported === 1 ? "" : "s"
            } from @${result.inatUsername}.`,
          });
        } catch (err: any) {
          toast({
            title: "Could not link iNaturalist",
            description:
              err?.message ||
              "You can connect it later from Edit profile.",
            variant: "destructive",
          });
        }
      }

      setLocation(`/u/${user.username}`);
    } catch (err: any) {
      toast({
        title: "Sign up failed",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-serif text-xl font-semibold mb-2">Create an account</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Log your sightings, build a life list of Australian herpetofauna, and connect with other naturalists.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            pattern="[A-Za-z0-9_]{3,32}"
            title="3–32 characters, letters/numbers/underscore only"
            autoComplete="username"
            data-testid="input-username"
          />
          <p className="text-xs text-muted-foreground mt-1">Letters, numbers, underscores. 3–32 chars.</p>
        </div>
        <div>
          <Label htmlFor="displayName">Display name (optional)</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-testid="input-display-name"
          />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
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
            minLength={6}
            autoComplete="new-password"
            data-testid="input-password"
          />
          <p className="text-xs text-muted-foreground mt-1">At least 6 characters.</p>
        </div>
        <div className="pt-2 border-t border-border">
          <Label htmlFor="inatUsername">iNaturalist username (optional)</Label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">
              @
            </span>
            <Input
              id="inatUsername"
              value={inatUsername}
              onChange={(e) => setInatUsername(e.target.value)}
              placeholder="your-inat-handle"
              autoComplete="off"
              className="pl-7"
              data-testid="input-inat-username"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Link your{" "}
            <a
              href="https://www.inaturalist.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary"
            >
              iNaturalist
            </a>{" "}
            account to import your research-grade herp observations. You can skip this and link it later from Edit profile.
          </p>
        </div>
        <Button type="submit" disabled={submitting} className="w-full" data-testid="button-signup">
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <div className="text-sm text-muted-foreground mt-6 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline" data-testid="link-login">
          Log in
        </Link>
      </div>
    </div>
  );
}
