import { useEffect, useState } from "react";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconCode,
  IconLoader2,
  IconPlus,
  IconTrash,
  IconDeviceFloppy,
  IconShield,
  IconShieldCheck,
  IconUsers,
  IconPencil,
  IconX,
  IconUserPlus,
  IconUserCheck,
  IconAlertCircle,
  IconKey,
  IconInfoCircle,
  IconSparkles,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContentTypeScopeBar } from "@/components/capabilities/ContentTypeScopeBar";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDebugAuth, getDebugUserName } from "@/hooks/useDebugAuth";
import { CAPABILITY_REGISTRY, CONTENT_MUTATE_CAPABILITIES } from "@shared/capabilities";
import { IconLock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { AuthTab } from "@/components/settings/AuthTab";

type SecurityTab = "roles" | "users" | "auth" | "captcha";

const SECURITY_TABS: {
  id: SecurityTab;
  href: string;
  label: string;
  Icon: typeof IconShield;
  requiresManage: boolean;
}[] = [
  { id: "roles", href: "/private/security/roles", label: "Staff Roles", Icon: IconShield, requiresManage: true },
  { id: "users", href: "/private/security/users", label: "Staff Users", Icon: IconUsers, requiresManage: true },
  { id: "auth", href: "/private/security/auth", label: "Consumer Auth", Icon: IconUserCheck, requiresManage: false },
  { id: "captcha", href: "/private/security/captcha", label: "Captcha", Icon: IconShieldCheck, requiresManage: false },
];

function resolveSecurityTab(pathname: string): SecurityTab | null {
  if (pathname === "/private/security/roles") return "roles";
  if (pathname === "/private/security/users") return "users";
  if (pathname === "/private/security/auth") return "auth";
  if (pathname === "/private/security/captcha") return "captcha";
  return null;
}
interface CapabilityGrant {
  name: string;
  contentTypes?: string[] | "*";
}

interface RoleDefinition {
  label: string;
  description?: string;
  capabilities: CapabilityGrant[];
}

interface AdminRolesResponse {
  roles: Record<string, RoleDefinition>;
  builtInDescriptionOverrides: Record<string, string>;
}

interface UserRecord {
  id?: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  lastLoginAt?: string;
  roles: string[];
  /** Missing ⇒ true (MCP overlay; CMS roles unchanged). */
  mcpReadEnabled?: boolean;
  mcpWriteEnabled?: boolean;
}

function normalizeUserMcpAccess(user: UserRecord): { mcpReadEnabled: boolean; mcpWriteEnabled: boolean } {
  const mcpReadEnabled = user.mcpReadEnabled !== false;
  const mcpWriteEnabled = mcpReadEnabled && user.mcpWriteEnabled !== false;
  return { mcpReadEnabled, mcpWriteEnabled };
}

interface PendingUserRecord {
  email: string;
  role: string;
  createdAt: string;
}

interface CapabilityFormState { enabled: boolean; contentTypes: string; }
interface RoleFormState {
  id: string;
  label: string;
  description: string;
  capabilities: Record<string, CapabilityFormState>;
}

/** Slugify a role label into a valid role id (`^[a-z][a-z0-9_-]*$`). */
function slugifyRoleId(label: string): string {
  const raw = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!raw) return "";
  if (/^[a-z]/.test(raw)) return raw;
  return `r_${raw}`;
}

function isValidRoleIdFormat(id: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(id);
}

const CONTENT_MUTATE_SET = new Set<string>(CONTENT_MUTATE_CAPABILITIES);
/** Global caps that should also auto-enable content_view (all types). */
const AUTO_VIEW_GLOBAL = new Set<string>(["edit_redirects"]);

function parseScopeList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Empty string = all content types. */
function mergeContentTypeScopes(a: string, b: string): string {
  if (!a.trim() || !b.trim()) return "";
  return Array.from(new Set([...parseScopeList(a), ...parseScopeList(b)])).join(", ");
}

function withAutoContentView(
  caps: Record<string, CapabilityFormState>,
  changedName: string,
  nextState: CapabilityFormState,
): Record<string, CapabilityFormState> {
  const updated = { ...caps, [changedName]: nextState };
  if (!nextState.enabled) return updated;

  const isScopedMutate = CONTENT_MUTATE_SET.has(changedName);
  const isEditRedirects = AUTO_VIEW_GLOBAL.has(changedName);
  if (!isScopedMutate && !isEditRedirects) return updated;

  const view = updated.content_view ?? { enabled: false, contentTypes: "" };
  const incomingScope = isEditRedirects ? "" : nextState.contentTypes;
  updated.content_view = {
    enabled: true,
    contentTypes: view.enabled
      ? mergeContentTypeScopes(view.contentTypes, incomingScope)
      : incomingScope,
  };
  return updated;
}

function capGrantsFromFormState(map: Record<string, CapabilityFormState>): CapabilityGrant[] {
  return Object.entries(map)
    .filter(([, v]) => v.enabled)
    .map(([name, v]) => ({
      name,
      contentTypes: v.contentTypes.trim()
        ? (v.contentTypes.split(",").map((s) => s.trim()).filter(Boolean) as string[])
        : ("*" as "*"),
    }));
}

function capMapFromGrants(grants: CapabilityGrant[]): Record<string, CapabilityFormState> {
  const map: Record<string, CapabilityFormState> = {};
  for (const cap of grants) {
    map[cap.name] = {
      enabled: true,
      contentTypes: Array.isArray(cap.contentTypes) ? cap.contentTypes.join(", ") : "",
    };
  }
  return map;
}

function CapabilityFields({
  caps,
  onChange,
}: {
  caps: Record<string, CapabilityFormState>;
  onChange: (updated: Record<string, CapabilityFormState>) => void;
}) {
  let previousScopedEnabled: string | null = null;

  return (
    <div className="space-y-2 pt-1">
      {CAPABILITY_REGISTRY.map((cap) => {
        const state = caps[cap.name] ?? { enabled: false, contentTypes: "" };
        const syncFromName =
          cap.scoped && state.enabled ? previousScopedEnabled : null;
        if (cap.scoped && state.enabled) {
          previousScopedEnabled = cap.name;
        }

        return (
          <div key={cap.name} className="space-y-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`cap-${cap.name}`}
                checked={state.enabled}
                onCheckedChange={(checked) =>
                  onChange(withAutoContentView(caps, cap.name, { ...state, enabled: !!checked }))
                }
                data-testid={`checkbox-cap-${cap.name}`}
              />
              <div className="flex-1 min-w-0">
                <label htmlFor={`cap-${cap.name}`} className="text-xs cursor-pointer">
                  {cap.label}
                </label>
                <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                  {cap.description}
                </p>
              </div>
              {cap.scoped && (
                <span className="text-xs text-muted-foreground shrink-0">scopeable</span>
              )}
            </div>
            {cap.scoped && state.enabled && (
              <div className="ml-6">
                <ContentTypeScopeBar
                  value={state.contentTypes}
                  onChange={(v) =>
                    onChange(withAutoContentView(caps, cap.name, { ...state, contentTypes: v }))
                  }
                  sameAsValue={
                    syncFromName != null
                      ? (caps[syncFromName] ?? { enabled: false, contentTypes: "" }).contentTypes
                      : null
                  }
                  testId={`scope-ct-${cap.name}`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RoleAgentDescriptionField({
  description,
  onDescriptionChange,
  onGenerateClick,
  generating,
  inputTestId,
  generateTestId,
  helperExtra,
}: {
  description: string;
  onDescriptionChange: (value: string) => void;
  onGenerateClick: () => void;
  generating: boolean;
  inputTestId: string;
  generateTestId: string;
  helperExtra?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground">Description for AI agents</label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              disabled={generating}
              onClick={onGenerateClick}
              data-testid={generateTestId}
              aria-label="Generate description for AI agents"
            >
              {generating ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconSparkles className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-center">
            Draft a short description agents use to pick this MCP connector over similar roles. You can edit before
            saving.
          </TooltipContent>
        </Tooltip>
      </div>
      <Input
        placeholder="SEO only: meta, clusters, redirects. Do not edit page sections or structure."
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        data-testid={inputTestId}
      />
      <p className="text-xs text-muted-foreground">
        Required. Used for MCP connectors at{" "}
        <code className="font-mono text-[11px] bg-muted px-1 rounded">/mcp/role/…</code>. Agents read this to decide
        which connector to use{helperExtra ? ` — ${helperExtra}` : "."}
      </p>
    </div>
  );
}

function parseApiErrorMessage(message: string, fallback: string): string {
  const jsonMatch = message.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return message || fallback;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { error?: string };
    return parsed.error?.trim() || message || fallback;
  } catch {
    return message || fallback;
  }
}

function RolesTab() {
  const { toast } = useToast();
  const { isValidated } = useDebugAuth();
  const { data: rolesResponse, isLoading } = useQuery<AdminRolesResponse>({
    queryKey: ["/api/admin/roles"],
    enabled: isValidated === true,
  });
  const rolesData = rolesResponse?.roles;
  const builtInDescriptionOverrides = rolesResponse?.builtInDescriptionOverrides ?? {};

  const [newRoleForm, setNewRoleForm] = useState<RoleFormState | null>(null);
  /** When true, label changes no longer overwrite the id (user edited id manually). */
  const [newRoleIdTouched, setNewRoleIdTouched] = useState(false);
  const [debouncedNewRoleId, setDebouncedNewRoleId] = useState("");
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editRoleForm, setEditRoleForm] = useState<Omit<RoleFormState, "id"> | null>(null);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingRoleDescription, setGeneratingRoleDescription] = useState(false);
  const [confirmGenerateDescription, setConfirmGenerateDescription] = useState<{
    target: "new" | "edit" | "builtin";
    roleId?: string;
  } | null>(null);
  const [editingBuiltinDescRoleId, setEditingBuiltinDescRoleId] = useState<string | null>(null);
  const [builtinDescForm, setBuiltinDescForm] = useState("");
  const [expandedRoleIds, setExpandedRoleIds] = useState<Set<string>>(() => new Set());

  const roles = rolesData ? Object.entries(rolesData) : [];

  function setRoleExpanded(roleId: string, open: boolean) {
    setExpandedRoleIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(roleId);
      else next.delete(roleId);
      return next;
    });
  }
  useEffect(() => {
    if (!newRoleForm) {
      setDebouncedNewRoleId("");
      return;
    }
    const id = newRoleForm.id;
    const t = setTimeout(() => setDebouncedNewRoleId(id), 400);
    return () => clearTimeout(t);
  }, [newRoleForm?.id, newRoleForm]);

  const newRoleIdStatus: "empty" | "typing" | "invalid" | "taken" | "available" = (() => {
    if (!newRoleForm) return "empty";
    const id = newRoleForm.id.trim();
    if (!id) return "empty";
    if (id !== debouncedNewRoleId) return "typing";
    if (!isValidRoleIdFormat(id)) return "invalid";
    if (rolesData && id in rolesData) return "taken";
    return "available";
  })();

  function startNewRole() {
    setNewRoleForm({ id: "", label: "", description: "", capabilities: {} });
    setNewRoleIdTouched(false);
    setDebouncedNewRoleId("");
    setEditingRoleId(null);
    setEditRoleForm(null);
    setEditingBuiltinDescRoleId(null);
    setBuiltinDescForm("");
  }

  function startEditBuiltinDescription(roleId: string, role: RoleDefinition) {
    setEditingBuiltinDescRoleId(roleId);
    setBuiltinDescForm(role.description || "");
    setEditingRoleId(null);
    setEditRoleForm(null);
    setNewRoleForm(null);
    setNewRoleIdTouched(false);
  }

  async function saveBuiltinDescription() {
    if (!editingBuiltinDescRoleId) return;
    if (!builtinDescForm.trim()) {
      toast({
        title: "Description for AI agents is required",
        description:
          "Agents use this text to choose which MCP connector (/mcp/role/…) to use and what they should do.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/roles/${editingBuiltinDescRoleId}/builtin-description`,
        { description: builtinDescForm.trim() },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save description");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      setEditingBuiltinDescRoleId(null);
      setBuiltinDescForm("");
      toast({ title: "MCP description saved" });
    } catch (err: any) {
      toast({
        title: "Failed to save description",
        description: parseApiErrorMessage(err?.message ?? "", "Failed to save description"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function resetBuiltinDescription(roleId: string) {
    setSaving(true);
    try {
      const res = await apiRequest("PATCH", `/api/admin/roles/${roleId}/builtin-description`, {
        reset: true,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to reset description");
      }
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      if (editingBuiltinDescRoleId === roleId) {
        setBuiltinDescForm(typeof data.description === "string" ? data.description : "");
      }
      toast({ title: "Reset to code default" });
    } catch (err: any) {
      toast({
        title: "Failed to reset description",
        description: parseApiErrorMessage(err?.message ?? "", "Failed to reset description"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function startEditRole(roleId: string, role: RoleDefinition) {
    setEditingRoleId(roleId);
    setEditRoleForm({
      label: role.label,
      description: role.description || "",
      capabilities: capMapFromGrants(role.capabilities),
    });
    setNewRoleForm(null);
    setNewRoleIdTouched(false);
    setEditingBuiltinDescRoleId(null);
    setBuiltinDescForm("");
  }

  async function saveNewRole() {
    if (!newRoleForm) return;
    if (!newRoleForm.id || !newRoleForm.label) {
      toast({ title: "Required fields missing", description: "Role ID and label are required", variant: "destructive" });
      return;
    }
    if (!isValidRoleIdFormat(newRoleForm.id)) {
      toast({
        title: "Invalid role ID",
        description: "ID must start with a letter and use only lowercase letters, numbers, hyphens, or underscores.",
        variant: "destructive",
      });
      return;
    }
    if (rolesData && newRoleForm.id in rolesData) {
      toast({
        title: "Role ID already taken",
        description: `A role with id "${newRoleForm.id}" already exists. Choose a different id.`,
        variant: "destructive",
      });
      return;
    }
    if (!newRoleForm.description.trim()) {
      toast({
        title: "Description for AI agents is required",
        description:
          "Agents use this text to choose which MCP connector (/mcp/role/…) to use and what they should do.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest("POST", "/api/admin/roles", {
        id: newRoleForm.id,
        label: newRoleForm.label,
        description: newRoleForm.description.trim(),
        capabilities: capGrantsFromFormState(newRoleForm.capabilities),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save role");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      setNewRoleForm(null);
      setNewRoleIdTouched(false);
      toast({ title: "Role created" });
    } catch (err: any) {
      toast({ title: "Failed to save role", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveEditRole() {
    if (!editingRoleId || !editRoleForm) return;
    if (!editRoleForm.label) {
      toast({ title: "Label is required", variant: "destructive" });
      return;
    }
    if (!editRoleForm.description.trim()) {
      toast({
        title: "Description for AI agents is required",
        description:
          "Agents use this text to choose which MCP connector (/mcp/role/…) to use and what they should do.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest("PUT", `/api/admin/roles/${editingRoleId}`, {
        label: editRoleForm.label,
        description: editRoleForm.description.trim(),
        capabilities: capGrantsFromFormState(editRoleForm.capabilities),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update role");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      setEditingRoleId(null);
      setEditRoleForm(null);
      toast({ title: "Role updated" });
    } catch (err: any) {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteRole(roleId: string) {
    try {
      const res = await apiRequest("DELETE", `/api/admin/roles/${roleId}`, undefined);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete role");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      setDeletingRoleId(null);
      toast({ title: "Role deleted" });
    } catch (err: any) {
      setDeletingRoleId(null);
      toast({ title: "Failed to delete role", description: err.message, variant: "destructive" });
    }
  }

  function requestGenerateRoleDescription(target: "new" | "edit", roleId?: string) {
    const form = target === "new" ? newRoleForm : editRoleForm;
    if (!form) return;

    const caps = capGrantsFromFormState(form.capabilities);
    if (caps.length === 0) {
      toast({
        title: "Select at least one capability first",
        variant: "destructive",
      });
      return;
    }

    if (form.description.trim()) {
      setConfirmGenerateDescription({ target, roleId });
      return;
    }

    void runGenerateRoleDescription(target, roleId);
  }

  function requestGenerateBuiltinDescription(roleId: string) {
    const role = rolesData?.[roleId];
    if (!role) return;
    if (builtinDescForm.trim()) {
      setConfirmGenerateDescription({ target: "builtin", roleId });
      return;
    }
    void runGenerateRoleDescription("builtin", roleId);
  }

  async function runGenerateRoleDescription(
    target: "new" | "edit" | "builtin",
    roleId?: string,
  ) {
    let label: string;
    let caps: CapabilityGrant[];

    if (target === "builtin") {
      const role = roleId ? rolesData?.[roleId] : undefined;
      if (!role || !roleId) return;
      label = role.label;
      caps = role.capabilities;
    } else {
      const form = target === "new" ? newRoleForm : editRoleForm;
      if (!form) return;
      caps = capGrantsFromFormState(form.capabilities);
      if (caps.length === 0) return;
      label = form.label.trim();
      if (!label) {
        toast({
          title: "Role label is required",
          description: "Enter a label before generating a description.",
          variant: "destructive",
        });
        return;
      }
    }

    setGeneratingRoleDescription(true);
    try {
      const res = await apiRequest("POST", "/api/ai/generate-role-description", {
        id:
          target === "edit"
            ? roleId
            : target === "builtin"
              ? roleId
              : newRoleForm?.id.trim()
                ? newRoleForm.id.trim()
                : undefined,
        label,
        capabilities: caps,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate description");
      }

      if (target === "new" && newRoleForm) {
        setNewRoleForm({ ...newRoleForm, description: data.description });
      } else if (target === "edit" && editRoleForm) {
        setEditRoleForm({ ...editRoleForm, description: data.description });
      } else if (target === "builtin") {
        setBuiltinDescForm(data.description);
      }
      toast({ title: "Description generated" });
    } catch (err: any) {
      toast({
        title: "Failed to generate description",
        description: parseApiErrorMessage(
          err?.message ?? "",
          "Failed to generate description",
        ),
        variant: "destructive",
      });
    } finally {
      setGeneratingRoleDescription(false);
      setConfirmGenerateDescription(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
    <Card>
      <CardContent className="p-card-padding pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define internal staff roles and assign capabilities to them. These are not related to website consumer users.
          MCP agents only see tools the caller&apos;s grants allow. Tick <span className="font-medium">View content</span> for YAML reads;
          enabling an edit cap auto-ticks view (you can uncheck it). After a role change, refresh the MCP server in Cursor.
        </p>
        <Button variant="outline" size="sm" onClick={startNewRole} data-testid="button-new-role">
          <IconPlus className="h-4 w-4 mr-1.5" />
          New role
        </Button>
      </div>

      {newRoleForm && (
        <Card data-testid="card-new-role">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-sm font-medium">New role</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setNewRoleForm(null)}>
              <IconX className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Label</label>
                <Input
                  placeholder="Content Editor"
                  value={newRoleForm.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setNewRoleForm((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        label,
                        id: newRoleIdTouched ? prev.id : slugifyRoleId(label),
                      };
                    });
                  }}
                  data-testid="input-new-role-label"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">ID</label>
                <div className="relative">
                  <Input
                    placeholder="content_editor"
                    value={newRoleForm.id}
                    onChange={(e) => {
                      setNewRoleIdTouched(true);
                      setNewRoleForm({
                        ...newRoleForm,
                        id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                      });
                    }}
                    className="pr-9"
                    aria-invalid={
                      newRoleIdStatus === "taken" || newRoleIdStatus === "invalid"
                        ? true
                        : undefined
                    }
                    data-testid="input-new-role-id"
                  />
                  <span
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    data-testid="status-new-role-id"
                    aria-live="polite"
                  >
                    {newRoleIdStatus === "typing" && (
                      <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {newRoleIdStatus === "available" && (
                      <IconCheck className="h-4 w-4 text-status-online" />
                    )}
                    {(newRoleIdStatus === "taken" || newRoleIdStatus === "invalid") && (
                      <IconX className="h-4 w-4 text-destructive" />
                    )}
                  </span>
                </div>
                {newRoleIdStatus === "taken" && (
                  <p className="text-xs text-destructive">This role ID is already taken.</p>
                )}
                {newRoleIdStatus === "invalid" && (
                  <p className="text-xs text-destructive">
                    Must start with a letter; use lowercase letters, numbers, hyphens, or underscores.
                  </p>
                )}
              </div>
            </div>
            <RoleAgentDescriptionField
              description={newRoleForm.description}
              onDescriptionChange={(description) => setNewRoleForm({ ...newRoleForm, description })}
              onGenerateClick={() => requestGenerateRoleDescription("new")}
              generating={generatingRoleDescription}
              inputTestId="input-new-role-description"
              generateTestId="button-generate-role-description"
              helperExtra="say what this role should and should not do"
            />
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Capabilities</label>
              <p className="text-xs text-muted-foreground">
                Editors need View content for MCP reads. Ticking any content edit cap enables View content for the same types.
              </p>
              <CapabilityFields
                caps={newRoleForm.capabilities}
                onChange={(updated) => setNewRoleForm({ ...newRoleForm, capabilities: updated })}
              />
            </div>
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                onClick={saveNewRole}
                disabled={
                  saving ||
                  newRoleIdStatus === "taken" ||
                  newRoleIdStatus === "invalid" ||
                  newRoleIdStatus === "empty" ||
                  newRoleIdStatus === "typing"
                }
                data-testid="button-save-new-role"
              >
                {saving ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconDeviceFloppy className="h-4 w-4 mr-1.5" />}
                Save role
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {roles.length === 0 && !newRoleForm && (
          <p className="text-sm text-muted-foreground text-center py-8">No roles defined yet.</p>
        )}
        {roles.map(([roleId, role]) => {
          const isBuiltIn =
            roleId === "user_admin" ||
            roleId === "platform_steward" ||
            roleId === "platform_ops" ||
            roleId === "metrics_viewer" ||
            roleId === "content_viewer";
          const isEditing = editingRoleId === roleId;
          const isEditingBuiltinDesc = editingBuiltinDescRoleId === roleId;
          const isDeleting = deletingRoleId === roleId;
          const hasCustomMcpDescription = Boolean(builtInDescriptionOverrides[roleId]);
          const isExpanded =
            expandedRoleIds.has(roleId) || isEditing || isEditingBuiltinDesc || isDeleting;
          return (
            <Collapsible
              key={roleId}
              open={isExpanded}
              onOpenChange={(open) => {
                if (isEditing || isEditingBuiltinDesc || isDeleting) return;
                setRoleExpanded(roleId, open);
              }}
            >
            <Card data-testid={`card-role-${roleId}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 px-card-padding py-3 space-y-0">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 flex-1 min-w-0 text-left rounded-md hover:bg-muted/50 -ml-1 px-1 py-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid={`button-toggle-role-${roleId}`}
                  >
                    <IconChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        isExpanded && "rotate-180",
                      )}
                    />
                    <code className="text-xs font-mono text-muted-foreground shrink-0">{roleId}</code>
                    {isEditing && editRoleForm ? (
                      <Input
                        value={editRoleForm.label}
                        onChange={(e) => setEditRoleForm({ ...editRoleForm, label: e.target.value })}
                        className="text-sm font-medium h-7"
                        data-testid={`input-edit-role-label-${roleId}`}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="text-sm font-medium truncate">{role.label}</span>
                    )}
                    {isBuiltIn && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="secondary"
                            className="text-xs shrink-0 cursor-default gap-1"
                            data-testid="badge-role-managed-by-code"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <IconCode className="h-3 w-3" />
                            managed by code
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-center">
                          Capabilities and labels sync from code on every server start. MCP descriptions can be customized
                          for agents without changing permissions.
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {isBuiltIn && hasCustomMcpDescription && !isEditingBuiltinDesc && (
                      <Badge variant="outline" className="text-xs shrink-0" data-testid={`badge-custom-mcp-desc-${roleId}`}>
                        custom MCP description
                      </Badge>
                    )}
                  </button>
                </CollapsibleTrigger>
                <div className="flex items-center gap-1 shrink-0">
                  {isBuiltIn && !isEditingBuiltinDesc && !isDeleting && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setRoleExpanded(roleId, true);
                        startEditBuiltinDescription(roleId, role);
                      }}
                      data-testid={`button-edit-builtin-desc-${roleId}`}
                      aria-label="Edit MCP description"
                    >
                      <IconSparkles className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                  {!isBuiltIn && !isEditing && !isDeleting && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setRoleExpanded(roleId, true);
                          startEditRole(roleId, role);
                        }}
                        data-testid={`button-edit-role-${roleId}`}
                      >
                        <IconPencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setRoleExpanded(roleId, true);
                          setDeletingRoleId(roleId);
                        }}
                        data-testid={`button-delete-role-${roleId}`}
                      >
                        <IconTrash className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </>
                  )}
                  {isEditingBuiltinDesc && (
                    <>
                      <Button
                        size="sm"
                        onClick={saveBuiltinDescription}
                        disabled={saving}
                        data-testid={`button-save-builtin-desc-${roleId}`}
                      >
                        {saving ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconCheck className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingBuiltinDescRoleId(null);
                          setBuiltinDescForm("");
                        }}
                        data-testid={`button-cancel-builtin-desc-${roleId}`}
                      >
                        <IconX className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {isEditing && (
                    <>
                      <Button
                        size="sm"
                        onClick={saveEditRole}
                        disabled={saving}
                        data-testid={`button-save-edit-role-${roleId}`}
                      >
                        {saving ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconCheck className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setEditingRoleId(null); setEditRoleForm(null); }}
                        data-testid={`button-cancel-edit-role-${roleId}`}
                      >
                        <IconX className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <CollapsibleContent>
              <CardContent className="pt-0">
                {isDeleting ? (
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-sm text-muted-foreground flex-1">
                      Delete "{role.label}"? This cannot be undone.
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => confirmDeleteRole(roleId)}
                      data-testid={`button-confirm-delete-role-${roleId}`}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeletingRoleId(null)}
                      data-testid={`button-cancel-delete-role-${roleId}`}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : isEditingBuiltinDesc ? (
                  <div className="space-y-3">
                    <RoleAgentDescriptionField
                      description={builtinDescForm}
                      onDescriptionChange={setBuiltinDescForm}
                      onGenerateClick={() => requestGenerateBuiltinDescription(roleId)}
                      generating={generatingRoleDescription}
                      inputTestId={`input-builtin-desc-${roleId}`}
                      generateTestId={`button-generate-builtin-desc-${roleId}`}
                      helperExtra="contrast this connector vs other built-in roles"
                    />
                    {hasCustomMcpDescription && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => void resetBuiltinDescription(roleId)}
                        data-testid={`button-reset-builtin-desc-${roleId}`}
                      >
                        Reset to code default
                      </Button>
                    )}
                  </div>
                ) : isEditing && editRoleForm ? (
                  <div className="space-y-3">
                    <RoleAgentDescriptionField
                      description={editRoleForm.description}
                      onDescriptionChange={(description) =>
                        setEditRoleForm({ ...editRoleForm, description })
                      }
                      onGenerateClick={() => requestGenerateRoleDescription("edit", roleId)}
                      generating={generatingRoleDescription}
                      inputTestId={`input-edit-role-desc-${roleId}`}
                      generateTestId={`button-generate-role-description-${roleId}`}
                    />
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Capabilities</label>
                      <p className="text-xs text-muted-foreground">
                        Editors need View content for MCP reads. Ticking any content edit cap enables View content for the same types.
                      </p>
                      <CapabilityFields
                        caps={editRoleForm.capabilities}
                        onChange={(updated) => setEditRoleForm({ ...editRoleForm, capabilities: updated })}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    {role.description ? (
                      <p className="text-xs text-muted-foreground mb-2">{role.description}</p>
                    ) : (
                      <p className="text-xs text-destructive mb-2">
                        Missing description for AI agents — edit this role before using /mcp/role/{roleId}.
                      </p>
                    )}
                    {isBuiltIn && !isEditingBuiltinDesc && (
                      <p className="text-[11px] text-muted-foreground mb-2">
                        Use the sparkle button to edit the MCP agent description. Capabilities cannot be changed here.
                      </p>
                    )}
                    {roleId === "user_admin" && (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          Manage who can access the CMS. Does not edit content, SEO, or server settings.
                        </p>
                        <details className="mb-2 group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
                            <IconChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                            Read more (advanced)
                          </summary>
                          <div className="mt-2 text-xs text-muted-foreground space-y-1.5 pl-4 border-l border-border">
                            <p>
                              Grants only <code className="font-mono">users_manage</code>. First login auto-assigns
                              this role when no user_admin exists. MCP connector: <code className="font-mono">/mcp/role/user_admin</code>.
                            </p>
                          </div>
                        </details>
                      </>
                    )}
                    {roleId === "platform_steward" && (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          Site health: diagnostics, runtime issues, redirects, SEO settings, and content architecture reads.
                        </p>
                        <details className="mb-2 group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
                            <IconChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                            Read more (advanced)
                          </summary>
                          <div className="mt-2 text-xs text-muted-foreground space-y-1.5 pl-4 border-l border-border">
                            <p>
                              Private surfaces include Diagnostics, Runtime issues, Redirects, SEO settings tabs, Component
                              insights. MCP connector: <code className="font-mono">/mcp/role/platform_steward</code>.
                            </p>
                          </div>
                        </details>
                      </>
                    )}
                    {roleId === "platform_ops" && (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          Infrastructure: sites.yml, new sites, Sidequest restart and dashboard.
                        </p>
                        <details className="mb-2 group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
                            <IconChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                            Read more (advanced)
                          </summary>
                          <div className="mt-2 text-xs text-muted-foreground space-y-1.5 pl-4 border-l border-border">
                            <p>
                              Grants <code className="font-mono">sites_manage</code>,{" "}
                              <code className="font-mono">worker_manage</code>, and{" "}
                              <code className="font-mono">migrations_run</code>. Prod Sidequest restart uses a flag file
                              + systemd path unit (docs/vps.md). MCP:{" "}
                              <code className="font-mono">/mcp/role/platform_ops</code>.
                            </p>
                          </div>
                        </details>
                      </>
                    )}
                    {roleId === "content_viewer" && (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          MCP-only YAML reads (entries, type contracts, component schemas, playbooks). No writes,
                          no diagnostics jobs, no FAQ database.
                        </p>
                        <details className="mb-2 group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
                            <IconChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                            Read more (advanced)
                          </summary>
                          <div className="mt-2 text-xs text-muted-foreground space-y-1.5 pl-4 border-l border-border">
                            <p>
                              Grants only <code className="font-mono">content_view</code> (all content types).
                              MCP <code className="font-mono">tools/list</code> is filtered in production from this grant.
                            </p>
                            <p>
                              Does not include <code className="font-mono">seo_edit</code>,{" "}
                              <code className="font-mono">edit_redirects</code>, FAQ item CRUD,
                              or starting diagnostics jobs. After assigning this role, refresh the MCP server in Cursor.
                            </p>
                            <p>
                              Defined in <code className="font-mono">shared/capabilities.ts</code> and{" "}
                              <code className="font-mono">server/user-store.ts</code>. Catalog map:{" "}
                              <code className="font-mono">shared/mcp-tool-catalog.ts</code>.
                            </p>
                          </div>
                        </details>
                      </>
                    )}
                    {roleId === "metrics_viewer" && (
                      <details className="mb-2 group">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
                          <IconChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                          Read more (advanced)
                        </summary>
                        <div className="mt-2 text-xs text-muted-foreground space-y-1.5 pl-4 border-l border-border">
                          <p>
                            Grants only <code className="font-mono">metrics_view</code> — read diagnostics,
                            component insights, error log, conversions, and tracking.
                          </p>
                          <p>
                            Does not allow starting diagnostics jobs, rebuilding insights, applying fixers,
                            or saving tracking/conversion settings.
                          </p>
                          <p>
                            Defined in <code className="font-mono">shared/capabilities.ts</code> and synced from{" "}
                            <code className="font-mono">server/user-store.ts</code> on every server start.
                          </p>
                        </div>
                      </details>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {role.capabilities.map((cap) => (
                        <Badge key={cap.name} variant="outline" className="text-xs font-mono">
                          {cap.name}
                          {Array.isArray(cap.contentTypes) && cap.contentTypes.length > 0 && (
                            <span className="text-muted-foreground ml-1">({cap.contentTypes.join(",")})</span>
                          )}
                        </Badge>
                      ))}
                      {role.capabilities.length === 0 && (
                        <span className="text-xs text-muted-foreground">No capabilities assigned</span>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
              </CollapsibleContent>
            </Card>
            </Collapsible>
          );
        })}
      </div>
      </CardContent>
      </Card>

      <AlertDialog
        open={!!confirmGenerateDescription}
        onOpenChange={(open) => !open && setConfirmGenerateDescription(null)}
      >
        <AlertDialogContent data-testid="dialog-replace-role-description">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace description?</AlertDialogTitle>
            <AlertDialogDescription>
              Generated text will overwrite the current description. You can still edit before saving the role.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generatingRoleDescription}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={generatingRoleDescription}
              onClick={(e) => {
                e.preventDefault();
                if (confirmGenerateDescription) {
                  void runGenerateRoleDescription(
                    confirmGenerateDescription.target,
                    confirmGenerateDescription.roleId,
                  );
                }
              }}
            >
              {generatingRoleDescription ? (
                <>
                  <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                "Replace"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function UsersTab() {
  const { toast } = useToast();
  const { isValidated } = useDebugAuth();
  const { data: users, isLoading: usersLoading } = useQuery<UserRecord[]>({
    queryKey: ["/api/admin/users"],
    enabled: isValidated === true,
  });
  const { data: pendingUsers, isLoading: pendingLoading } = useQuery<PendingUserRecord[]>({
    queryKey: ["/api/admin/pending-users"],
    enabled: isValidated === true,
  });
  const { data: rolesResponse } = useQuery<AdminRolesResponse>({
    queryKey: ["/api/admin/roles"],
    enabled: isValidated === true,
  });
  const rolesData = rolesResponse?.roles;

  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState<string>("");
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("");
  const [addingSaving, setAddingSaving] = useState(false);

  const [deletingPendingEmail, setDeletingPendingEmail] = useState<string | null>(null);
  const [assigningEmail, setAssigningEmail] = useState<string | null>(null);
  const [assignTargetUsername, setAssignTargetUsername] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);
  const [mcpAccessSaving, setMcpAccessSaving] = useState<string | null>(null);
  const [mcpAdvancedOpen, setMcpAdvancedOpen] = useState(false);

  const allRoles = rolesData ? Object.entries(rolesData) : [];
  const allUsers = users ?? [];

  function startEditRoles(user: UserRecord) {
    setEditingUser(user.username);
    setEditingUsername(user.username);
    setUserRoles([...user.roles]);
  }

  async function saveMcpAccess(
    username: string,
    flags: { mcpReadEnabled?: boolean; mcpWriteEnabled?: boolean },
  ) {
    setMcpAccessSaving(username);
    try {
      const res = await apiRequest("PUT", `/api/admin/users/${encodeURIComponent(username)}/mcp-access`, flags);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update MCP access");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "MCP access updated" });
    } catch (err: any) {
      toast({ title: "Failed to update MCP access", description: err.message, variant: "destructive" });
    } finally {
      setMcpAccessSaving(null);
    }
  }

  async function saveUserRoles(originalUsername: string) {
    const trimmedUsername = editingUsername.trim();
    if (!trimmedUsername) {
      toast({ title: "Username cannot be empty", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let activeUsername = originalUsername;
      if (trimmedUsername !== originalUsername) {
        const renameRes = await apiRequest("PATCH", `/api/admin/users/${originalUsername}`, { username: trimmedUsername });
        if (!renameRes.ok) {
          const err = await renameRes.json();
          throw new Error(err.error || "Failed to rename user");
        }
        activeUsername = trimmedUsername;
      }
      const rolesRes = await apiRequest("PUT", `/api/admin/users/${activeUsername}/roles`, { roles: userRoles });
      if (!rolesRes.ok) {
        const err = await rolesRes.json();
        throw new Error(err.error || "Failed to update roles");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditingUser(null);
      toast({ title: "User updated" });
    } catch (err: any) {
      toast({ title: "Failed to update user", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPendingUser() {
    if (!newEmail.trim() || !newRole) {
      toast({ title: "Email and role are required", variant: "destructive" });
      return;
    }
    setAddingSaving(true);
    try {
      const res = await apiRequest("POST", "/api/admin/pending-users", { email: newEmail.trim(), role: newRole });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add user");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-users"] });
      setShowAddForm(false);
      setNewEmail("");
      setNewRole("");
      toast({ title: "User pre-registered", description: `${newEmail.trim()} will receive the role on next login.` });
    } catch (err: any) {
      toast({ title: "Failed to add user", description: err.message, variant: "destructive" });
    } finally {
      setAddingSaving(false);
    }
  }

  async function handleDeletePending(email: string) {
    try {
      const res = await apiRequest("DELETE", `/api/admin/pending-users/${encodeURIComponent(email)}`, undefined);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to remove pending user");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-users"] });
      setDeletingPendingEmail(null);
      toast({ title: "Pending user removed" });
    } catch (err: any) {
      setDeletingPendingEmail(null);
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    }
  }

  async function handleAssignPending() {
    if (!assigningEmail || !assignTargetUsername) return;
    setAssignSaving(true);
    try {
      const res = await apiRequest("POST", `/api/admin/pending-users/${encodeURIComponent(assigningEmail)}/assign`, { username: assignTargetUsername });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to assign");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setAssigningEmail(null);
      setAssignTargetUsername("");
      toast({ title: "Role assigned", description: `User "${assignTargetUsername}" has been granted the role.` });
    } catch (err: any) {
      toast({ title: "Failed to assign", description: err.message, variant: "destructive" });
    } finally {
      setAssignSaving(false);
    }
  }

  if (usersLoading || pendingLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pending = pendingUsers ?? [];

  return (
    <Card>
      <CardContent className="p-card-padding pt-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Manage staff users and pre-register people by email before they log in. These are internal staff accounts only — they have no relation to your real web consumer users.
        </p>
        <Button variant="outline" size="sm" onClick={() => { setShowAddForm(true); setAssigningEmail(null); setDeletingPendingEmail(null); }} data-testid="button-add-user">
          <IconUserPlus className="h-4 w-4 mr-1.5" />
          Add User
        </Button>
      </div>

      {showAddForm && (
        <Card data-testid="card-add-pending-user">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-sm font-medium">Pre-register user</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setShowAddForm(false)}>
              <IconX className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
              <p><span className="font-medium text-foreground">No email will be sent.</span> The user receives no notification of this entry.</p>
              <p>Access is granted automatically when they log in via Breathecode and their account email matches the one entered here.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Email address</label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddPendingUser(); }}
                data-testid="input-pending-email"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                data-testid="select-pending-role"
              >
                <option value="">Select a role…</option>
                {allRoles.map(([roleId, role]) => (
                  <option key={roleId} value={roleId}>{role.label}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={handleAddPendingUser} disabled={addingSaving} data-testid="button-save-pending-user">
                {addingSaving ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconDeviceFloppy className="h-4 w-4 mr-1.5" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending</p>
          {pending.map((p) => {
            const isDeleting = deletingPendingEmail === p.email;
            const isAssigning = assigningEmail === p.email;
            return (
              <Card key={p.email} data-testid={`card-pending-${p.email}`}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{p.email}</span>
                      <Badge variant="outline" className="text-xs shrink-0">Pending</Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Role:</span>
                      <Badge variant="secondary" className="text-xs">{rolesData?.[p.role]?.label || p.role}</Badge>
                    </div>
                  </div>
                  {!isDeleting && !isAssigning && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Assign to existing user"
                        onClick={() => { setAssigningEmail(p.email); setAssignTargetUsername(""); setDeletingPendingEmail(null); }}
                        data-testid={`button-assign-pending-${p.email}`}
                      >
                        <IconUserCheck className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setDeletingPendingEmail(p.email); setAssigningEmail(null); }}
                        data-testid={`button-delete-pending-${p.email}`}
                      >
                        <IconTrash className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </CardHeader>
                {(isDeleting || isAssigning) && (
                  <CardContent className="pt-0">
                    {isDeleting && (
                      <div className="flex items-center gap-2 py-1">
                        <span className="text-sm text-muted-foreground flex-1">Remove this pending entry?</span>
                        <Button size="sm" variant="destructive" onClick={() => handleDeletePending(p.email)} data-testid={`button-confirm-delete-pending-${p.email}`}>Remove</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeletingPendingEmail(null)} data-testid={`button-cancel-delete-pending-${p.email}`}>Cancel</Button>
                      </div>
                    )}
                    {isAssigning && (
                      <div className="space-y-2 py-1">
                        <p className="text-xs text-muted-foreground">Assign this pre-registration to an existing user, bypassing the email match.</p>
                        <div className="flex items-center gap-2">
                          <select
                            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                            value={assignTargetUsername}
                            onChange={(e) => setAssignTargetUsername(e.target.value)}
                            data-testid={`select-assign-user-${p.email}`}
                          >
                            <option value="">Select a user…</option>
                            {allUsers.map((u) => (
                              <option key={u.username} value={u.username}>
                                {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username} ({u.username})
                              </option>
                            ))}
                          </select>
                          <Button size="sm" onClick={handleAssignPending} disabled={!assignTargetUsername || assignSaving} data-testid={`button-confirm-assign-${p.email}`}>
                            {assignSaving ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconCheck className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setAssigningEmail(null)} data-testid={`button-cancel-assign-${p.email}`}>
                            <IconX className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {allUsers.length > 0 && (
        <div className="space-y-2">
          {pending.length > 0 && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active</p>}
          <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1.5">
            <p className="text-xs text-muted-foreground">
              MCP read lets agents look up and explain content. MCP write lets agents change content.
              These toggles do not change what the person can do in the CMS.
            </p>
            <Collapsible open={mcpAdvancedOpen} onOpenChange={setMcpAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground">
                  {mcpAdvancedOpen ? "Hide advanced details" : "Read more (advanced)"}
                  <IconChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${mcpAdvancedOpen ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1 space-y-1 text-xs text-muted-foreground">
                <p>
                  Write-off keeps only view capabilities for MCP: <code className="font-mono text-[11px]">content_view</code>,{" "}
                  <code className="font-mono text-[11px]">metrics_view</code>,{" "}
                  <code className="font-mono text-[11px]">read_redirects</code>.
                </p>
                <p>Enforced on MCP requests via the server secret; CMS login and roles are unchanged. Missing flags default to both on.</p>
              </CollapsibleContent>
            </Collapsible>
          </div>
          {allUsers.map((user) => {
            const { mcpReadEnabled, mcpWriteEnabled } = normalizeUserMcpAccess(user);
            const mcpBusy = mcpAccessSaving === user.username;
            return (
            <Card key={user.username} data-testid={`card-user-${user.username}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username}
                    </span>
                    <code className="text-xs font-mono text-muted-foreground">{user.username}</code>
                    {!mcpReadEnabled && (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-mcp-off-${user.username}`}>
                        MCP off
                      </Badge>
                    )}
                    {mcpReadEnabled && !mcpWriteEnabled && (
                      <Badge variant="secondary" className="text-xs" data-testid={`badge-mcp-read-only-${user.username}`}>
                        MCP read only
                      </Badge>
                    )}
                  </div>
                  {user.email && (
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  )}
                </div>
                {editingUser === user.username ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      onClick={() => saveUserRoles(user.username)}
                      disabled={saving}
                      data-testid={`button-save-user-roles-${user.username}`}
                    >
                      {saving ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconCheck className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingUser(null)}
                      data-testid={`button-cancel-user-${user.username}`}
                    >
                      <IconX className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => startEditRoles(user)}
                    data-testid={`button-edit-user-${user.username}`}
                  >
                    <IconPencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {editingUser === user.username ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor={`username-input-${user.username}`}>
                        Username
                      </label>
                      <Input
                        id={`username-input-${user.username}`}
                        value={editingUsername}
                        onChange={(e) => setEditingUsername(e.target.value)}
                        disabled={user.username === getDebugUserName()}
                        placeholder="Username"
                        required
                        data-testid={`input-username-${user.username}`}
                      />
                      {user.username === getDebugUserName() && (
                        <p className="text-xs text-muted-foreground">Cannot rename your own account</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                    {allRoles.map(([roleId, role]) => (
                      <div key={roleId} className="flex items-center gap-2">
                        <Checkbox
                          id={`user-role-${user.username}-${roleId}`}
                          checked={userRoles.includes(roleId)}
                          onCheckedChange={(checked) =>
                            setUserRoles(checked
                              ? [...userRoles, roleId]
                              : userRoles.filter((r) => r !== roleId))
                          }
                          data-testid={`checkbox-user-role-${user.username}-${roleId}`}
                        />
                        <label htmlFor={`user-role-${user.username}-${roleId}`} className="text-xs cursor-pointer">
                          {role.label}
                        </label>
                      </div>
                    ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {user.roles.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No roles assigned</span>
                    ) : (
                      user.roles.map((roleId) => (
                        <Badge key={roleId} variant="secondary" className="text-xs">
                          {rolesData?.[roleId]?.label || roleId}
                        </Badge>
                      ))
                    )}
                    {user.lastLoginAt && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        Last login: {new Date(user.lastLoginAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-2 border-t pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={`mcp-read-${user.username}`} className="text-xs font-medium cursor-pointer inline-flex items-center gap-1.5">
                      Allow using MCP to
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-semibold uppercase tracking-wide">
                        read
                      </Badge>
                      data
                    </label>
                    <Switch
                      id={`mcp-read-${user.username}`}
                      checked={mcpReadEnabled}
                      disabled={mcpBusy}
                      onCheckedChange={(checked) =>
                        saveMcpAccess(user.username, {
                          mcpReadEnabled: checked,
                          ...(checked ? {} : { mcpWriteEnabled: false }),
                        })
                      }
                      data-testid={`switch-mcp-read-${user.username}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor={`mcp-write-${user.username}`}
                      className={`text-xs font-medium inline-flex items-center gap-1.5 ${mcpReadEnabled ? "cursor-pointer" : "text-muted-foreground"}`}
                    >
                      Allow using MCP to
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-semibold uppercase tracking-wide">
                        write
                      </Badge>
                      data
                    </label>
                    <Switch
                      id={`mcp-write-${user.username}`}
                      checked={mcpWriteEnabled}
                      disabled={mcpBusy || !mcpReadEnabled}
                      onCheckedChange={(checked) =>
                        saveMcpAccess(user.username, { mcpWriteEnabled: checked })
                      }
                      data-testid={`switch-mcp-write-${user.username}`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {allUsers.length === 0 && pending.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
          <IconAlertCircle className="h-8 w-8" />
          <p className="text-sm">No users yet. Pre-register users above, or wait for someone to log in.</p>
        </div>
      )}
      </CardContent>
    </Card>
  );
}

function CaptchaTab() {
  const { data, isLoading } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/turnstile/status"],
  });

  const configured = data?.configured ?? false;

  const verifySnippet = `// POST https://challenges.cloudflare.com/turnstile/v0/siteverify
// Request body (JSON):
{
  "secret": "<your-TURNSTILE_SECRET_KEY>",
  "response": "<token-from-lead-payload>"
}

// Success response:
{
  "success": true,
  "challenge_ts": "2024-01-01T00:00:00.000Z",
  "hostname": "yourdomain.com"
}

// Failure response:
{
  "success": false,
  "error-codes": ["invalid-input-response"]
}`;

  return (
    <div className="space-y-4">
      <Card data-testid="card-captcha-info">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 flex-wrap">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <IconShieldCheck className="h-4 w-4 text-muted-foreground" />
            Cloudflare Turnstile
          </CardTitle>
          {isLoading ? (
            <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" data-testid="spinner-turnstile-status" />
          ) : configured ? (
            <Badge variant="outline" className="gap-1.5 text-sm px-3 py-1 text-green-700 dark:text-green-400 border-green-500/40 bg-green-500/10" data-testid="badge-turnstile-configured">
              <IconCheck className="h-4 w-4" />
              Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-400" data-testid="badge-turnstile-not-configured">
              <IconAlertCircle className="h-3 w-3" />
              Not configured
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-6">

          <div className="space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <IconInfoCircle className="h-4 w-4 text-muted-foreground shrink-0" />
              How it works
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The Cloudflare Turnstile widget runs in the browser and presents an invisible challenge to the visitor.
              Once solved, Cloudflare issues a short-lived token. That token is included in the lead form payload and
              POSTed to <code className="font-mono bg-muted rounded px-1 py-0.5 text-xs">/api/turnstile/verify</code> on
              this server, which calls Cloudflare's <code className="font-mono bg-muted rounded px-1 py-0.5 text-xs">siteverify</code> API
              server-to-server. Only a successful response from Cloudflare allows the lead submission to proceed.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <IconCode className="h-4 w-4 text-muted-foreground shrink-0" />
              Token sent to your backend
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              When a lead is submitted, the Turnstile response token is included in the payload as{" "}
              <code className="font-mono bg-muted rounded px-1 py-0.5 text-xs">token</code>. External backends that
              receive webhook leads can independently re-verify it directly with Cloudflare using their own secret key:
            </p>
            <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto leading-relaxed" data-testid="pre-verify-snippet">
              <code>{verifySnippet}</code>
            </pre>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <IconKey className="h-4 w-4 text-muted-foreground shrink-0" />
              Environment variables
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Both keys are read from <code className="font-mono bg-muted rounded px-1 py-0.5 text-xs">process.env</code> on
              the Express server (<code className="font-mono bg-muted rounded px-1 py-0.5 text-xs">server/routes/forms.ts</code>).
            </p>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Variable</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs bg-muted rounded px-1 py-0.5">TURNSTILE_SITE_KEY</code>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      Public key embedded in the frontend widget. Safe to expose to the browser.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs bg-muted rounded px-1 py-0.5">TURNSTILE_SECRET_KEY</code>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      Private key used for server-side verification. Never exposed to the browser.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <IconShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
              How to obtain the keys
            </h3>
            <ol className="space-y-1.5 text-sm text-muted-foreground list-none">
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-foreground">1.</span>
                <span>Go to <code className="font-mono bg-muted rounded px-1 py-0.5 text-xs">dash.cloudflare.com</code> and navigate to <strong className="text-foreground font-medium">Turnstile</strong> in the sidebar.</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-foreground">2.</span>
                <span>Click <strong className="text-foreground font-medium">Add widget</strong>, enter a name and your domain, then click <strong className="text-foreground font-medium">Create</strong>.</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-foreground">3.</span>
                <span>Copy the <strong className="text-foreground font-medium">Site Key</strong> shown on the widget detail page.</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-foreground">4.</span>
                <span>Click <strong className="text-foreground font-medium">Secret Key</strong> to reveal and copy it.</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-foreground">5.</span>
                <span>Add both values as Replit secrets named <code className="font-mono bg-muted rounded px-1 py-0.5 text-xs">TURNSTILE_SITE_KEY</code> and <code className="font-mono bg-muted rounded px-1 py-0.5 text-xs">TURNSTILE_SECRET_KEY</code>.</span>
              </li>
            </ol>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}

export default function SecurityPage() {
  const { hasCapability } = useDebugAuth();
  const canManageUsers = hasCapability("users_manage");
  const [pathname, setLocation] = useLocation();
  const activeTab = resolveSecurityTab(pathname);

  useEffect(() => {
    if (pathname === "/private/security" || pathname === "/private/security/") {
      setLocation(canManageUsers ? "/private/security/roles" : "/private/security/captcha");
    }
  }, [pathname, canManageUsers, setLocation]);

  if (!activeTab) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/private/settings">
              <Button variant="ghost" size="icon" data-testid="button-back-security">
                <IconArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold" data-testid="text-security-title">Security</h1>
              <p className="text-sm text-muted-foreground">Roles, users and security configuration</p>
            </div>
          </div>

          <ToggleButtonBar
            value={activeTab}
            onValueChange={(id) => {
              const tab = SECURITY_TABS.find((t) => t.id === id);
              if (!tab) return;
              if (tab.requiresManage && !canManageUsers) return;
              setLocation(tab.href);
            }}
            listTestId="security-tablist"
            listClassName="flex"
          >
            {SECURITY_TABS.map(({ id, label, Icon, requiresManage }) => {
              const disabled = requiresManage && !canManageUsers;
              return (
                <ToggleButtonBarTrigger
                  key={id}
                  value={id}
                  disabled={disabled}
                  data-testid={`tab-${id}`}
                  className="gap-1.5"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </ToggleButtonBarTrigger>
              );
            })}
          </ToggleButtonBar>
        </div>

        <div role="tabpanel">
          {activeTab === "roles" && (
            canManageUsers ? (
              <RolesTab />
            ) : (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground" data-testid="div-security-access-denied">
                <IconLock className="h-10 w-10 opacity-40" />
                <p className="text-sm font-medium">Access denied</p>
                <p className="text-xs text-center max-w-xs">
                  You don't have permission to manage roles and users. Contact a user admin to request access.
                </p>
              </div>
            )
          )}

          {activeTab === "users" && (
            canManageUsers ? (
              <UsersTab />
            ) : (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
                <IconLock className="h-10 w-10 opacity-40" />
                <p className="text-sm font-medium">Access denied</p>
                <p className="text-xs text-center max-w-xs">
                  You don't have permission to manage roles and users. Contact a user admin to request access.
                </p>
              </div>
            )
          )}

          {activeTab === "auth" && <AuthTab />}

          {activeTab === "captcha" && <CaptchaTab />}
        </div>
      </div>
    </div>
  );
}
