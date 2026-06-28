import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  apiListAdminUsers,
  apiSetUserRole,
  apiSetUserPermissions,
  apiGetAuditLog,
  hasRoleAtLeast,
  ADMIN_CAPABILITIES,
  CAPABILITY_LABELS,
  ROLE_DEFAULT_CAPABILITIES,
  apiGetDistributionImportStatus,
  apiStartDistributionImport,
  apiCancelDistributionImport,
  apiListInatBlocks,
  apiAddInatBlock,
  apiDeleteInatBlock,
  apiListAdminSpecies,
  apiInatTaxonLookup,
  apiCreateAdminSpecies,
  apiUpdateAdminSpecies,
  apiHideAdminSpecies,
  apiDeleteAdminSpecies,
  type InatBlockRow,
  type AdminSpeciesRow,
  type InatTaxonLookupResult,
  type AdminUserRow,
  type AdminCapability,
  type CapabilityMap,
  type UserRole,
  type DistributionImportStatus,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Shield, ScrollText, Users as UsersIcon, KeyRound, Map as MapIcon, Play, Square, RefreshCw, UserX, Trash2, Leaf, Plus, Pencil, EyeOff, Eye, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

const ROLE_VALUES: UserRole[] = [
  "none",
  "moderator",
  "editor",
  "admin",
  "super-admin",
];

const ROLE_LABEL: Record<UserRole, string> = {
  none: "No role",
  moderator: "Moderator",
  editor: "Editor",
  admin: "Admin",
  "super-admin": "Super-Admin",
};

const ROLE_BADGE: Record<UserRole, string> = {
  none: "bg-muted text-muted-foreground",
  moderator: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  editor: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  admin: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "super-admin":
    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function Admin() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [query, setQuery] = useState("");

  // Role-gate: client-side redirect for users without any role
  if (!user || !user.role || user.role === "none") {
    setLocation("/");
    return null;
  }

  const canManageRoles = hasRoleAtLeast(user, "super-admin");

  const usersQ = useQuery({
    queryKey: ["/api/admin/users"],
    queryFn: () => apiListAdminUsers(),
  });

  const auditQ = useQuery({
    queryKey: ["/api/admin/audit"],
    queryFn: () => apiGetAuditLog(),
  });

  const setRoleMut = useMutation({
    mutationFn: ({ username, role }: { username: string; role: UserRole }) =>
      apiSetUserRole(username, role),
    onSuccess: (_, vars) => {
      toast({ title: `${vars.username} is now ${ROLE_LABEL[vars.role]}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit"] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not update role",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const setPermsMut = useMutation({
    mutationFn: ({
      username,
      permissions,
    }: {
      username: string;
      permissions: CapabilityMap | null;
    }) => apiSetUserPermissions(username, permissions),
    onSuccess: (_, vars) => {
      toast({ title: `Permissions updated for ${vars.username}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not update permissions",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const filtered = (usersQ.data?.users ?? []).filter((u) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      (u.displayName ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-amber-500" />
        <div>
          <h1 className="text-xl font-semibold">Admin panel</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <strong>{user.username}</strong> ·{" "}
            <span className={`px-1.5 py-0.5 rounded text-xs ${ROLE_BADGE[user.role as UserRole]}`}>
              {ROLE_LABEL[user.role as UserRole]}
            </span>
          </p>
        </div>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users">
            <UsersIcon className="h-4 w-4 mr-1.5" /> Users
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <ScrollText className="h-4 w-4 mr-1.5" /> Audit log
          </TabsTrigger>
          <TabsTrigger value="distribution" data-testid="tab-distribution">
            <MapIcon className="h-4 w-4 mr-1.5" /> Distribution
          </TabsTrigger>
          <TabsTrigger value="inat-blocks" data-testid="tab-inat-blocks">
            <UserX className="h-4 w-4 mr-1.5" /> iNat blocklist
          </TabsTrigger>
          <TabsTrigger value="species" data-testid="tab-species">
            <Leaf className="h-4 w-4 mr-1.5" /> Species
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Users &amp; roles</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Search by username, name, or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="mb-4 max-w-sm"
                data-testid="input-admin-search"
              />
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-border">
                      <th className="py-2 px-4">User</th>
                      <th className="py-2 px-4">Role</th>
                      {canManageRoles ? (
                        <th className="py-2 px-4">Permissions</th>
                      ) : null}
                      <th className="py-2 px-4 hidden sm:table-cell">Email</th>
                      <th className="py-2 px-4 hidden md:table-cell">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u: AdminUserRow) => (
                      <tr
                        key={u.id}
                        className="border-b border-border/50"
                        data-testid={`row-user-${u.username}`}
                      >
                        <td className="py-2 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-muted overflow-hidden">
                              {u.avatarDataUrl ? (
                                <img
                                  src={u.avatarDataUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : null}
                            </div>
                            <div>
                              <div className="font-medium">
                                {u.displayName || u.username}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                @{u.username}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-4">
                          {canManageRoles && u.id !== user.id ? (
                            <Select
                              value={u.role}
                              onValueChange={(val) =>
                                setRoleMut.mutate({
                                  username: u.username,
                                  role: val as UserRole,
                                })
                              }
                            >
                              <SelectTrigger
                                className="h-8 w-[150px]"
                                data-testid={`select-role-${u.username}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_VALUES.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {ROLE_LABEL[r]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge
                              variant="secondary"
                              className={ROLE_BADGE[u.role]}
                              data-testid={`badge-role-${u.username}`}
                            >
                              {ROLE_LABEL[u.role]}
                            </Badge>
                          )}
                        </td>
                        {canManageRoles ? (
                          <td className="py-2 px-4">
                            <PermissionsCell
                              row={u}
                              isSelf={u.id === user.id}
                              isPending={
                                setPermsMut.isPending &&
                                setPermsMut.variables?.username === u.username
                              }
                              onSave={(perms) =>
                                setPermsMut.mutate({
                                  username: u.username,
                                  permissions: perms,
                                })
                              }
                            />
                          </td>
                        ) : null}
                        <td className="py-2 px-4 hidden sm:table-cell text-muted-foreground">
                          {u.email ?? ""}
                        </td>
                        <td className="py-2 px-4 hidden md:table-cell text-muted-foreground">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {usersQ.isLoading ? (
                  <div className="py-8 text-center text-muted-foreground">
                    Loading users…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No users found.
                  </div>
                ) : null}
              </div>
              {!canManageRoles ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Only super-admins can change user roles.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent admin actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(auditQ.data?.entries ?? []).map((e) => (
                  <div
                    key={e.id}
                    className="flex flex-wrap items-baseline gap-x-2 text-sm border-b border-border/40 pb-2"
                    data-testid={`row-audit-${e.id}`}
                  >
                    <span className="font-medium">
                      {e.actor?.username ?? `user#${e.actor?.id ?? "?"}`}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                      {e.action}
                    </span>
                    <span className="text-muted-foreground">
                      → {e.targetType} #{e.targetId}
                    </span>
                    {e.detail ? (
                      <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                        {e.detail}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
                {auditQ.isLoading ? (
                  <div className="py-6 text-center text-muted-foreground">
                    Loading…
                  </div>
                ) : (auditQ.data?.entries ?? []).length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground">
                    No admin actions logged yet.
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distribution" className="mt-4">
          <DistributionPanel />
        </TabsContent>

        <TabsContent value="inat-blocks" className="mt-4">
          <InatBlocklistPanel />
        </TabsContent>

        <TabsContent value="species" className="mt-4">
          <SpeciesAdminPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ───── Distribution import panel ─────
function DistributionPanel() {
  const { toast } = useToast();
  const queryKey = ["/api/admin/distribution/import"];
  const { data, isLoading } = useQuery<DistributionImportStatus>({
    queryKey,
    queryFn: apiGetDistributionImportStatus,
    refetchInterval: (q) => {
      const s = q.state.data;
      return s?.running ? 2000 : false;
    },
  });

  const start = useMutation({
    mutationFn: () => apiStartDistributionImport(),
    onSuccess: (r) => {
      if (r.started) {
        toast({ title: "Import started" });
      } else {
        toast({
          title: "Could not start",
          description: r.reason ?? "unknown",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) =>
      toast({ title: "Start failed", description: e.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: () => apiCancelDistributionImport(),
    onSuccess: () => {
      toast({ title: "Cancelling current job…" });
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const job = data?.job;
  const running = !!data?.running;
  const total = data?.catalogSize ?? job?.totalSpecies ?? 0;
  const processed = job?.processedSpecies ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" /> Distribution import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Pulls geotagged research-grade observations for every AU herp
          species from iNaturalist and ALA, dedupes them, and builds the 0.5°
          density grid. Safe to re-run — already-imported observations are
          skipped at the DB level.
        </p>
        <div className="flex items-center gap-3 text-sm">
          <Badge variant={running ? "default" : "outline"} data-testid="badge-import-status">
            {isLoading ? "…" : running ? "Running" : job?.status ?? "idle"}
          </Badge>
          <span className="text-muted-foreground" data-testid="text-import-progress">
            {processed.toLocaleString()} / {total.toLocaleString()} species ·{" "}
            {(job?.totalRecords ?? 0).toLocaleString()} new records
          </span>
        </div>
        <Progress value={pct} data-testid="progress-import" />
        {job?.currentSpeciesName && running && (
          <p className="text-xs text-muted-foreground">
            Currently: <span className="font-medium">{job.currentSpeciesName}</span>
            {job.currentSpeciesId ? ` (#${job.currentSpeciesId})` : null}
          </p>
        )}
        {job?.lastError && (
          <p className="text-xs text-destructive" data-testid="text-import-error">
            Last error: {job.lastError}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => start.mutate()}
            disabled={running || start.isPending}
            data-testid="button-start-import"
          >
            <Play className="h-4 w-4 mr-1.5" />
            {job?.status === "done" ? "Re-run full import" : "Start full import"}
          </Button>
          <Button
            variant="outline"
            onClick={() => cancel.mutate()}
            disabled={!running || cancel.isPending}
            data-testid="button-cancel-import"
          >
            <Square className="h-4 w-4 mr-1.5" /> Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey })}
            data-testid="button-refresh-import"
          >
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        </div>
        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          Tip: open any species profile and use the Distribution map’s edit
          tools to fine-tune individual species (toggle cells, draw range
          polygons, hide individual points).
        </div>
      </CardContent>
    </Card>
  );
}

// ───────── PermissionsCell ─────────
function PermissionsCell({
  row,
  isSelf,
  isPending,
  onSave,
}: {
  row: AdminUserRow;
  isSelf: boolean;
  isPending: boolean;
  onSave: (perms: CapabilityMap | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const roleDefaults = ROLE_DEFAULT_CAPABILITIES[row.role] ?? {};
  const explicit: CapabilityMap = row.permissions ?? {};

  // Local edit state — initialise from explicit overrides.
  const [draft, setDraft] = useState<CapabilityMap>(explicit);

  // Reset draft whenever popover opens or row changes.
  function onOpenChange(v: boolean) {
    if (v) setDraft(row.permissions ?? {});
    setOpen(v);
  }

  const overrideCount = Object.keys(explicit).length;

  function toggle(cap: AdminCapability, effective: boolean) {
    setDraft((prev) => {
      const next = { ...prev };
      const roleDefault = !!roleDefaults[cap];
      const newEffective = !effective;
      // If the new value matches the role default, clear the override; otherwise store it.
      if (newEffective === roleDefault) {
        delete next[cap];
      } else {
        next[cap] = newEffective;
      }
      return next;
    });
  }

  function handleSave() {
    const cleaned: CapabilityMap = {};
    for (const k of Object.keys(draft) as AdminCapability[]) {
      if (typeof draft[k] === "boolean") cleaned[k] = draft[k]!;
    }
    onSave(Object.keys(cleaned).length === 0 ? null : cleaned);
    setOpen(false);
  }

  function handleReset() {
    onSave(null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          data-testid={`button-permissions-${row.username}`}
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Permissions</span>
          {overrideCount > 0 ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {overrideCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">
              Permissions for @{row.username}
            </div>
            <p className="text-xs text-muted-foreground">
              Override role defaults. Unchanged boxes follow the {ROLE_LABEL[row.role]} role.
            </p>
          </div>
          <div className="space-y-2.5">
            {ADMIN_CAPABILITIES.map((cap) => {
              const roleDefault = !!roleDefaults[cap];
              const draftHas = Object.prototype.hasOwnProperty.call(draft, cap);
              const effective = draftHas ? !!draft[cap] : roleDefault;
              const isOverride = draftHas && draft[cap] !== roleDefault;
              const disabled =
                isSelf && cap === "manageRoles" && effective; // Disable un-checking own manageRoles
              return (
                <label
                  key={cap}
                  className="flex items-start gap-2 text-sm cursor-pointer"
                  data-testid={`label-cap-${cap}-${row.username}`}
                >
                  <Checkbox
                    checked={effective}
                    disabled={disabled || isPending}
                    onCheckedChange={() => toggle(cap, effective)}
                    data-testid={`checkbox-cap-${cap}-${row.username}`}
                  />
                  <div className="flex-1 leading-tight">
                    <div className="font-medium">
                      {CAPABILITY_LABELS[cap]}
                      {isOverride ? (
                        <span
                          className="ml-1.5 text-amber-600 dark:text-amber-400"
                          title="Override (differs from role default)"
                        >
                          •
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Role default: {roleDefault ? "allowed" : "denied"}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={isPending || overrideCount === 0}
              data-testid={`button-reset-perms-${row.username}`}
            >
              Reset to role
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isPending}
                data-testid={`button-save-perms-${row.username}`}
              >
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ───── iNat observer blocklist panel ─────
function InatBlocklistPanel() {
  const { toast } = useToast();
  const [login, setLogin] = useState("");
  const [note, setNote] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const blocksQ = useQuery({
    queryKey: ["/api/admin/inat-blocks"],
    queryFn: () => apiListInatBlocks(),
  });

  const addMut = useMutation({
    mutationFn: ({ login, note }: { login: string; note: string }) =>
      apiAddInatBlock(login, note),
    onSuccess: (res) => {
      toast({
        title: `Blocked @${res.block.login}`,
        description: res.resolved
          ? "Their existing records will no longer appear."
          : "Couldn’t resolve their iNat id — login-based filter is active.",
      });
      setLogin("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/inat-blocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit"] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not block",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDeleteInatBlock(id),
    onSuccess: () => {
      toast({ title: "Block removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/inat-blocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit"] });
      setPendingDeleteId(null);
    },
    onError: (err: any) => {
      toast({
        title: "Could not remove block",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
      setPendingDeleteId(null);
    },
  });

  const rows = blocksQ.data?.blocks ?? [];

  const handleAdd = () => {
    const trimmed = login.trim().replace(/^@/, "");
    if (!trimmed) {
      toast({ title: "Enter an iNat username", variant: "destructive" });
      return;
    }
    if (!/^[A-Za-z0-9_\-.]+$/.test(trimmed)) {
      toast({
        title: "That username has invalid characters",
        variant: "destructive",
      });
      return;
    }
    addMut.mutate({ login: trimmed, note: note.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">iNaturalist blocklist</CardTitle>
        <p className="text-sm text-muted-foreground">
          Hide all observations from a given iNat user across this app — both
          species photo galleries and distribution maps.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-2 items-start">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                iNat username
              </label>
              <Input
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="e.g. tomfrisby"
                data-testid="input-inat-block-login"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Note (optional)
              </label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why are they being blocked?"
                data-testid="input-inat-block-note"
              />
            </div>
            <div className="pt-5">
              <Button
                onClick={handleAdd}
                disabled={addMut.isPending}
                data-testid="button-inat-block-add"
              >
                {addMut.isPending ? "Adding…" : "Block user"}
              </Button>
            </div>
          </div>
        </div>

        <div className="border rounded-md">
          <div className="grid grid-cols-[1fr_1fr_2fr_auto] gap-3 px-3 py-2 border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <div>iNat user</div>
            <div>Blocked by</div>
            <div>Note</div>
            <div className="text-right pr-1">Actions</div>
          </div>
          {blocksQ.isLoading ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              No iNat users blocked yet.
            </div>
          ) : (
            rows.map((row) => (
              <InatBlockRowItem
                key={row.id}
                row={row}
                pendingDelete={pendingDeleteId === row.id}
                onConfirmDelete={() => setPendingDeleteId(row.id)}
                onCancelDelete={() => setPendingDeleteId(null)}
                onDelete={() => deleteMut.mutate(row.id)}
                deleting={deleteMut.isPending && pendingDeleteId === row.id}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InatBlockRowItem({
  row,
  pendingDelete,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  deleting,
}: {
  row: InatBlockRow;
  pendingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div
      className="grid grid-cols-[1fr_1fr_2fr_auto] gap-3 px-3 py-2.5 border-b last:border-b-0 items-center text-sm"
      data-testid={`row-inat-block-${row.login}`}
    >
      <div className="min-w-0">
        <a
          href={`https://www.inaturalist.org/people/${row.login}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium hover:underline truncate inline-block max-w-full"
        >
          @{row.login}
        </a>
        {row.label && row.label !== row.login ? (
          <div className="text-xs text-muted-foreground truncate">
            {row.label}
          </div>
        ) : null}
        {row.userId == null ? (
          <Badge variant="outline" className="mt-1 text-[10px]">
            login-only
          </Badge>
        ) : null}
      </div>
      <div className="text-muted-foreground truncate">
        {row.blockedBy ? `@${row.blockedBy.username}` : "—"}
      </div>
      <div className="text-muted-foreground truncate">{row.note ?? "—"}</div>
      <div className="text-right">
        {pendingDelete ? (
          <span className="inline-flex items-center gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={deleting}
              data-testid={`button-inat-block-confirm-${row.login}`}
            >
              {deleting ? "Removing…" : "Confirm"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancelDelete}
              disabled={deleting}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={onConfirmDelete}
            data-testid={`button-inat-block-delete-${row.login}`}
            title="Remove block"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ───── Species management panel ─────
const GROUP_OPTIONS = [
  { value: "snakes", label: "Snakes" },
  { value: "lizards", label: "Lizards" },
  { value: "turtles", label: "Turtles" },
  { value: "crocs", label: "Crocs" },
  { value: "frogs", label: "Frogs" },
] as const;

// When admin species change, every cache derived from the merged catalog must
// refetch so newly added (or hidden) species appear everywhere — admin table,
// field guide drilldown, species picker, species page, and tally denominators.
function invalidateCatalogCaches() {
  queryClient.invalidateQueries({ queryKey: ["/api/admin/species"] });
  queryClient.invalidateQueries({ queryKey: ["/api/species/catalog"] });
  queryClient.invalidateQueries({ queryKey: ["/api/subspecies/catalog"] });
  queryClient.invalidateQueries({ queryKey: ["/api/species/total"] });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/audit"] });
}

function SpeciesAdminPanel() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<AdminSpeciesRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminSpeciesRow | null>(null);

  const listQ = useQuery({
    queryKey: ["/api/admin/species", q, groupFilter],
    queryFn: () =>
      apiListAdminSpecies({
        q: q || undefined,
        group: groupFilter === "all" ? undefined : groupFilter,
      }),
  });

  const hideMut = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
      apiHideAdminSpecies(id, hidden),
    onSuccess: (res) => {
      toast({
        title: res.hidden ? "Species hidden" : "Species restored",
      });
      invalidateCatalogCaches();
    },
    onError: (err: any) => {
      toast({
        title: "Could not update",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDeleteAdminSpecies(id),
    onSuccess: () => {
      toast({ title: "Removed" });
      invalidateCatalogCaches();
      setPendingDelete(null);
    },
    onError: (err: any) => {
      toast({
        title: "Could not remove",
        description: err?.message || "Try again",
        variant: "destructive",
      });
      setPendingDelete(null);
    },
  });

  const rows = listQ.data?.species ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>Species management</span>
          <Button
            size="sm"
            onClick={() => setShowAddDialog(true)}
            data-testid="button-species-add"
          >
            <Plus className="h-4 w-4 mr-1" /> Add species
          </Button>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Browse every species the app knows about. Add newly described
          species (from iNat or fully manually), edit details, and hide or
          remove species from app listings.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_180px] gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by scientific or common name, family, genus…"
              className="pl-8"
              data-testid="input-species-search"
            />
          </div>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger data-testid="select-species-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {GROUP_OPTIONS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-xs text-muted-foreground">
          {listQ.isLoading ? "Loading…" : `${rows.length} species`}
        </div>

        <div className="border rounded-md overflow-hidden">
          <div className="grid grid-cols-[2fr_2fr_1.2fr_1fr_auto] gap-3 px-3 py-2 border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <div>Scientific name</div>
            <div>Common name</div>
            <div>Family / Group</div>
            <div>Source</div>
            <div className="text-right pr-1">Actions</div>
          </div>
          {listQ.isLoading ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              No matches
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className={`grid grid-cols-[2fr_2fr_1.2fr_1fr_auto] gap-3 px-3 py-2 border-b last:border-0 text-sm items-center ${
                    r.hidden ? "opacity-50" : ""
                  }`}
                  data-testid={`row-species-${r.id}`}
                >
                  <div className="font-medium italic">{r.scientific}</div>
                  <div>{r.common ?? <span className="text-muted-foreground">—</span>}</div>
                  <div className="text-xs">
                    <div>{r.familyName ?? "—"}</div>
                    <div className="text-muted-foreground capitalize">{r.group ?? "—"}</div>
                  </div>
                  <div>
                    <SourceBadge source={r.source} hidden={r.hidden} />
                  </div>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingRow(r)}
                      data-testid={`button-species-edit-${r.id}`}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        hideMut.mutate({ id: r.id, hidden: !r.hidden })
                      }
                      disabled={hideMut.isPending}
                      data-testid={`button-species-hide-${r.id}`}
                      title={r.hidden ? "Show in app" : "Hide from app"}
                    >
                      {r.hidden ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </Button>
                    {(r.source === "manual" ||
                      r.source === "inat" ||
                      r.source === "catalog-edited") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPendingDelete(r)}
                        data-testid={`button-species-delete-${r.id}`}
                        title={
                          r.source === "catalog-edited"
                            ? "Reset to upstream catalog"
                            : "Delete species"
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {showAddDialog && (
        <SpeciesAddDialog
          onClose={() => setShowAddDialog(false)}
          onSuccess={() => {
            setShowAddDialog(false);
            invalidateCatalogCaches();
          }}
        />
      )}

      {editingRow && (
        <SpeciesEditDialog
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSuccess={() => {
            setEditingRow(null);
            invalidateCatalogCaches();
          }}
        />
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.source === "catalog-edited"
                ? "Reset to upstream catalog?"
                : "Delete this species?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.source === "catalog-edited" ? (
                <>
                  This will discard your edits and restore the original
                  catalog values for{" "}
                  <em>{pendingDelete?.scientific}</em>.
                </>
              ) : (
                <>
                  This permanently removes{" "}
                  <em>{pendingDelete?.scientific}</em> from the app catalog.
                  Existing records that reference it will still exist but
                  will no longer link to a species page.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-species-delete-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                pendingDelete && deleteMut.mutate(pendingDelete.id)
              }
              data-testid="button-species-delete-confirm"
            >
              {pendingDelete?.source === "catalog-edited" ? "Reset" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SourceBadge({
  source,
  hidden,
}: {
  source: AdminSpeciesRow["source"];
  hidden: boolean;
}) {
  if (hidden) {
    return (
      <Badge variant="outline" className="text-xs">
        Hidden
      </Badge>
    );
  }
  if (source === "manual") {
    return <Badge className="text-xs">Manual</Badge>;
  }
  if (source === "inat") {
    return (
      <Badge variant="secondary" className="text-xs">
        Admin-added (iNat)
      </Badge>
    );
  }
  if (source === "catalog-edited") {
    return (
      <Badge variant="secondary" className="text-xs">
        Catalog · edited
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      Catalog
    </Badge>
  );
}

function SpeciesAddDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"inat" | "manual">("inat");

  // iNat-mode state
  const [lookupQ, setLookupQ] = useState("");
  const [lookupResults, setLookupResults] = useState<InatTaxonLookupResult[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [picked, setPicked] = useState<InatTaxonLookupResult | null>(null);

  // Shared / manual state
  const [scientific, setScientific] = useState("");
  const [common, setCommon] = useState("");
  const [group, setGroup] = useState<string>("snakes");
  const [familyName, setFamilyName] = useState("");
  const [genus, setGenus] = useState("");
  const [authority, setAuthority] = useState("");
  const [description, setDescription] = useState("");

  const createMut = useMutation({
    mutationFn: () => {
      if (mode === "inat" && !picked) {
        return Promise.reject(new Error("Pick an iNat taxon first"));
      }
      return apiCreateAdminSpecies({
        id: mode === "inat" ? picked!.id : undefined,
        source: mode,
        scientific: mode === "inat" ? picked!.scientific : scientific.trim(),
        common: (mode === "inat" ? picked!.common : common.trim()) || null,
        group: (mode === "inat" ? picked!.group : group) as any,
        familyId: mode === "inat" ? picked!.familyId : null,
        familyName: (mode === "inat" ? picked!.familyName : familyName.trim()) || null,
        genus: (mode === "inat" ? picked!.genus : genus.trim()) || null,
        authority: mode === "manual" ? authority.trim() || null : null,
        description: description.trim() || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Species added" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({
        title: "Could not add",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  const runLookup = async () => {
    if (!lookupQ.trim()) return;
    setLookupBusy(true);
    try {
      const res = await apiInatTaxonLookup(lookupQ.trim());
      setLookupResults(res.results);
      if (res.results.length === 0) {
        toast({ title: "No matches on iNat" });
      }
    } catch (err: any) {
      toast({
        title: "Lookup failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    } finally {
      setLookupBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add species</DialogTitle>
          <DialogDescription>
            Add by iNat taxon (preferred — pulls photos, records, and stays
            in sync) or fully manually (for species not yet on iNat, like
            newly described monitors).
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === "inat" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("inat")}
            data-testid="button-species-mode-inat"
          >
            Add from iNat
          </Button>
          <Button
            type="button"
            variant={mode === "manual" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("manual")}
            data-testid="button-species-mode-manual"
          >
            Add manually
          </Button>
        </div>

        {mode === "inat" ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={lookupQ}
                onChange={(e) => setLookupQ(e.target.value)}
                placeholder="Scientific name (e.g. Varanus iridis)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runLookup();
                  }
                }}
                data-testid="input-species-lookup"
              />
              <Button
                type="button"
                onClick={runLookup}
                disabled={lookupBusy}
                data-testid="button-species-lookup"
              >
                {lookupBusy ? "…" : "Search iNat"}
              </Button>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {lookupResults.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setPicked(r)}
                  className={`w-full text-left px-3 py-2 border rounded-md hover:bg-muted text-sm ${
                    picked?.id === r.id ? "border-primary bg-muted" : ""
                  }`}
                  data-testid={`button-species-pick-${r.id}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="italic font-medium">{r.scientific}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.common ?? "—"} ·{" "}
                        {r.familyName ?? "?"} · {r.group ?? "?"}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      iNat #{r.id} · {r.observationsCount} obs
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional admin notes / description"
                rows={3}
                data-testid="textarea-species-description"
              />
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Scientific name *</Label>
              <Input
                value={scientific}
                onChange={(e) => setScientific(e.target.value)}
                placeholder="e.g. Varanus iridis"
                data-testid="input-species-scientific"
              />
            </div>
            <div>
              <Label className="text-xs">Common name</Label>
              <Input
                value={common}
                onChange={(e) => setCommon(e.target.value)}
                placeholder="e.g. Rainbow Rock Monitor"
                data-testid="input-species-common"
              />
            </div>
            <div>
              <Label className="text-xs">Group *</Label>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger data-testid="select-species-group-form">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_OPTIONS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Family</Label>
              <Input
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="e.g. Varanidae"
                data-testid="input-species-family"
              />
            </div>
            <div>
              <Label className="text-xs">Genus</Label>
              <Input
                value={genus}
                onChange={(e) => setGenus(e.target.value)}
                placeholder="e.g. Varanus"
                data-testid="input-species-genus"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Authority</Label>
              <Input
                value={authority}
                onChange={(e) => setAuthority(e.target.value)}
                placeholder="e.g. Zozaya et al., 2026"
                data-testid="input-species-authority"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                data-testid="textarea-species-description-manual"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            data-testid="button-species-add-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => createMut.mutate()}
            disabled={
              createMut.isPending ||
              (mode === "inat" ? !picked : !scientific.trim())
            }
            data-testid="button-species-add-submit"
          >
            {createMut.isPending ? "Adding…" : "Add species"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SpeciesEditDialog({
  row,
  onClose,
  onSuccess,
}: {
  row: AdminSpeciesRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [scientific, setScientific] = useState(row.scientific);
  const [common, setCommon] = useState(row.common ?? "");
  const [group, setGroup] = useState(row.group ?? "snakes");
  const [familyName, setFamilyName] = useState(row.familyName ?? "");
  const [genus, setGenus] = useState(row.genus ?? "");
  const [authority, setAuthority] = useState(row.authority ?? "");
  const [description, setDescription] = useState(row.description ?? "");

  const updateMut = useMutation({
    mutationFn: () =>
      apiUpdateAdminSpecies(row.id, {
        scientific: scientific.trim() || undefined,
        common: common.trim() || null,
        group: group as any,
        familyName: familyName.trim() || null,
        genus: genus.trim() || null,
        authority: authority.trim() || null,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      toast({ title: "Species updated" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({
        title: "Could not update",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit species</DialogTitle>
          <DialogDescription>
            ID #{row.id} · Source: {row.source}
          </DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Scientific name</Label>
            <Input
              value={scientific}
              onChange={(e) => setScientific(e.target.value)}
              data-testid="input-species-edit-scientific"
            />
          </div>
          <div>
            <Label className="text-xs">Common name</Label>
            <Input
              value={common}
              onChange={(e) => setCommon(e.target.value)}
              data-testid="input-species-edit-common"
            />
          </div>
          <div>
            <Label className="text-xs">Group</Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger data-testid="select-species-edit-group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_OPTIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Family</Label>
            <Input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              data-testid="input-species-edit-family"
            />
          </div>
          <div>
            <Label className="text-xs">Genus</Label>
            <Input
              value={genus}
              onChange={(e) => setGenus(e.target.value)}
              data-testid="input-species-edit-genus"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Authority</Label>
            <Input
              value={authority}
              onChange={(e) => setAuthority(e.target.value)}
              data-testid="input-species-edit-authority"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              data-testid="textarea-species-edit-description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            data-testid="button-species-edit-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => updateMut.mutate()}
            disabled={updateMut.isPending}
            data-testid="button-species-edit-submit"
          >
            {updateMut.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
