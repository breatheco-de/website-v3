import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  IconUserCheck,
  IconLoader2,
  IconDeviceFloppy,
  IconAlertTriangle,
  IconCircleCheck,
  IconTrash,
  IconSend,
  IconLogin2,
  IconUserPlus,
  IconExternalLink,
  IconChevronDown,
  IconPencil,
  IconPlus,
  IconArrowRight,
  IconAsterisk,
  IconSelector,
  IconCheck,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { createVariableWidgetPlugin } from "@/lib/cm-variable-widgets";
import {
  AUTH_SIGNUP_FORM_FIELD_PRESETS,
  AUTH_SIGNUP_SESSION_FIELD_PRESETS,
  DEFAULT_AUTH_SIGNUP_FIELD_MAP,
  buildSignupPayloadPreviewJson,
  buildSignupTestPayloadFromFieldMap,
  isConstantEntry,
  isDynamicFromEntry,
  isFormSource,
  isGlobalEntry,
  isSessionSource,
  isSignupFieldMapReady,
  type AuthSignupFieldMapEntry,
} from "@shared/authSignupFieldMap";
import { useVariableDefinitions } from "@/hooks/useVariables";

type AuthHttpMethod = "GET" | "POST" | "PUT";

interface AuthEndpoint {
  path?: string;
  method?: AuthHttpMethod;
}

export interface AuthSettingsResponse {
  host?: string;
  academy?: string;
  login?: AuthEndpoint & {
    url?: string;
    payload?: Record<string, unknown>;
  };
  signup?: AuthEndpoint & {
    field_map?: AuthSignupFieldMapEntry[];
    payload?: Record<string, unknown>;
  };
  profile?: AuthEndpoint;
  signup_configured: boolean;
  signup_field_map_ready?: boolean;
}

type TestTarget = "login_url" | "login" | "signup" | "profile";

interface TestResult {
  ok: boolean;
  status?: number;
  url?: string;
  method?: string;
  body?: unknown;
  error?: string;
  elapsed_ms?: number;
}

const DEFAULT_LOGIN_PAYLOAD_TEXT = JSON.stringify(
  {
    email: "bob@gmail.com",
    password: "********",
  },
  null,
  2,
);

function asMethod(v: unknown, fallback: AuthHttpMethod): AuthHttpMethod {
  return v === "GET" || v === "POST" || v === "PUT" ? v : fallback;
}

function formatLog(result: TestResult | null): string {
  if (!result) return "";
  return JSON.stringify(result, null, 2);
}

function MethodSelect({
  value,
  onChange,
  testId,
  ariaLabel,
}: {
  value: AuthHttpMethod;
  onChange: (m: AuthHttpMethod) => void;
  testId: string;
  ariaLabel: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === "GET" || next === "POST" || next === "PUT") onChange(next);
      }}
    >
      <SelectTrigger
        className="w-[6.5rem] shrink-0 font-mono text-sm"
        data-testid={testId}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={value} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="GET">GET</SelectItem>
        <SelectItem value="POST">POST</SelectItem>
        <SelectItem value="PUT">PUT</SelectItem>
      </SelectContent>
    </Select>
  );
}

function isValidSignupFromPath(from: string): boolean {
  const t = from.trim();
  if (isFormSource(t)) return t.length > "form.".length;
  if (isSessionSource(t)) return t.length > "session.".length;
  return false;
}

type SignupFieldMapRowIssue = "blank" | "duplicate" | "empty_constant" | "empty_global";

function getSignupFieldMapIssues(
  rows: AuthSignupFieldMapEntry[],
): Map<number, SignupFieldMapRowIssue> {
  const issues = new Map<number, SignupFieldMapRowIssue>();
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const key = row.key.trim();
    if (!key) {
      issues.set(index, "blank");
      return;
    }
    const prev = seen.get(key);
    if (prev !== undefined) {
      issues.set(prev, "duplicate");
      issues.set(index, "duplicate");
      return;
    }
    seen.set(key, index);
    if (isConstantEntry(row) && !row.constant.trim()) {
      issues.set(index, "empty_constant");
    } else if (isGlobalEntry(row) && !row.global.trim()) {
      issues.set(index, "empty_global");
    }
  });
  return issues;
}

type SignupSourceMode = "from" | "constant" | "global";

function signupRowMode(row: AuthSignupFieldMapEntry): SignupSourceMode {
  if (isConstantEntry(row)) return "constant";
  if (isGlobalEntry(row)) return "global";
  return "from";
}

function ClickToEditPayloadKey({
  index,
  value,
  onChange,
  hasIssue,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
  hasIssue: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    onChange(draft.trim());
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={commit}
        placeholder="payload_key"
        className="text-xs font-mono h-7 w-28 flex-shrink-0"
        data-testid={`input-auth-signup-key-${index}`}
      />
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "group/key inline-flex items-center justify-end gap-1 text-xs font-mono w-28 flex-shrink-0 text-right truncate rounded-md px-1.5 py-1 hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring",
        hasIssue ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        !value.trim() && "italic",
      )}
      title={value.trim() || "Click to set payload key"}
      onClick={() => setEditing(true)}
      data-testid={`button-auth-signup-key-${index}`}
    >
      <span className="min-w-0 truncate">{value.trim() || "key"}</span>
      <IconPencil
        className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/key:opacity-70 group-focus-visible/key:opacity-70"
        aria-hidden
      />
    </button>
  );
}

function SignupFromCombobox({
  index,
  value,
  onChange,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const formPresets = useMemo(
    () => AUTH_SIGNUP_FORM_FIELD_PRESETS.map((name) => `form.${name}`),
    [],
  );
  const sessionPresets = useMemo(
    () => AUTH_SIGNUP_SESSION_FIELD_PRESETS.map((name) => `session.${name}`),
    [],
  );
  const allPresets = useMemo(
    () => [...formPresets, ...sessionPresets],
    [formPresets, sessionPresets],
  );

  const trimmedSearch = search.trim();
  const showCustom =
    isValidSignupFromPath(trimmedSearch) &&
    !allPresets.includes(trimmedSearch);

  const commit = (next: string) => {
    onChange(next.trim());
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
      modal={false}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-7 flex-1 min-w-0 justify-between font-normal px-2"
          data-testid={`select-auth-signup-from-${index}`}
        >
          <span
            className={cn(
              "font-mono text-xs truncate",
              !value && "text-muted-foreground",
            )}
          >
            {value || "form.email"}
          </span>
          <IconSelector className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[16rem] p-0"
        align="start"
      >
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="form.* or session.*…"
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValidSignupFromPath(trimmedSearch)) {
                e.preventDefault();
                commit(trimmedSearch);
              }
            }}
            data-testid={`input-auth-signup-from-search-${index}`}
          />
          <CommandList className="max-h-64">
            <CommandEmpty>
              {isValidSignupFromPath(trimmedSearch)
                ? `Press Enter to use “${trimmedSearch}”`
                : "Type a form.* or session.* path"}
            </CommandEmpty>
            {showCustom && (
              <CommandGroup heading="Custom">
                <CommandItem
                  value={`custom-${trimmedSearch}`}
                  onSelect={() => commit(trimmedSearch)}
                  className="font-mono text-xs"
                  data-testid={`option-auth-signup-from-custom-${index}`}
                >
                  <IconPlus className="mr-2 h-3.5 w-3.5 shrink-0" />
                  Use “{trimmedSearch}”
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="Form">
              {formPresets.map((path) => (
                <CommandItem
                  key={path}
                  value={path}
                  onSelect={() => commit(path)}
                  className="font-mono text-xs"
                  data-testid={`option-auth-signup-from-${index}-${path.replace(/\./g, "-")}`}
                >
                  <IconCheck
                    className={cn(
                      "mr-2 h-3.5 w-3.5 shrink-0",
                      value === path ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {path}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Session">
              {sessionPresets.map((path) => (
                <CommandItem
                  key={path}
                  value={path}
                  onSelect={() => commit(path)}
                  className="font-mono text-xs"
                  data-testid={`option-auth-signup-from-${index}-${path.replace(/\./g, "-")}`}
                >
                  <IconCheck
                    className={cn(
                      "mr-2 h-3.5 w-3.5 shrink-0",
                      value === path ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {path}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SignupGlobalCombobox({
  index,
  value,
  onChange,
  globalNames,
  unknown,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
  globalNames: string[];
  unknown: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const commit = (next: string) => {
    onChange(next.trim());
    setOpen(false);
    setSearch("");
  };

  return (
    <div className="flex-1 min-w-0 space-y-0.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
        modal={false}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "h-7 w-full justify-between font-normal px-2",
              unknown && "border-amber-500/50",
            )}
            data-testid={`select-auth-signup-global-${index}`}
          >
            <span
              className={cn(
                "font-mono text-xs truncate",
                !value && "text-muted-foreground",
                unknown && "text-amber-600 dark:text-amber-400",
              )}
            >
              {value || "global.name"}
            </span>
            <IconSelector className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] min-w-[16rem] p-0"
          align="start"
        >
          <Command shouldFilter={true}>
            <CommandInput
              placeholder="Search global.*…"
              value={search}
              onValueChange={setSearch}
              data-testid={`input-auth-signup-global-search-${index}`}
            />
            <CommandList className="max-h-64">
              <CommandEmpty>No global variables found.</CommandEmpty>
              <CommandGroup heading="Global">
                {globalNames.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => commit(name)}
                    className="font-mono text-xs"
                    data-testid={`option-auth-signup-global-${index}-${name.replace(/\./g, "-")}`}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3.5 w-3.5 shrink-0",
                        value === name ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {unknown ? (
        <p
          className="text-[10px] text-amber-600 dark:text-amber-400"
          data-testid={`text-auth-signup-global-unknown-${index}`}
        >
          Variable not found
        </p>
      ) : null}
    </div>
  );
}

export function AuthTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<AuthSettingsResponse>({
    queryKey: ["/api/settings/auth"],
  });
  const { data: variableDefinitions } = useVariableDefinitions();
  const globalVarNames = useMemo(() => {
    if (!variableDefinitions) return [] as string[];
    return Object.keys(variableDefinitions)
      .filter((n) => n.startsWith("global."))
      .sort((a, b) => a.localeCompare(b));
  }, [variableDefinitions]);

  const [host, setHost] = useState("");
  const [academy, setAcademy] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [loginPath, setLoginPath] = useState("");
  const [loginMethod, setLoginMethod] = useState<AuthHttpMethod>("POST");
  const [loginPayloadText, setLoginPayloadText] = useState(DEFAULT_LOGIN_PAYLOAD_TEXT);
  const [loginPayloadOpen, setLoginPayloadOpen] = useState(false);
  const [loginPayloadError, setLoginPayloadError] = useState<string | null>(null);
  const [signupPath, setSignupPath] = useState("");
  const [signupMethod, setSignupMethod] = useState<AuthHttpMethod>("POST");
  const [signupFieldMap, setSignupFieldMap] = useState<AuthSignupFieldMapEntry[]>(
    () => [...DEFAULT_AUTH_SIGNUP_FIELD_MAP],
  );
  const [signupPreviewOpen, setSignupPreviewOpen] = useState(false);
  const [profilePath, setProfilePath] = useState("");
  const [profileMethod, setProfileMethod] = useState<AuthHttpMethod>("GET");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [testTarget, setTestTarget] = useState<TestTarget | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [testToken, setTestToken] = useState("");
  const [testCallback, setTestCallback] = useState("");
  const [testPayloadText, setTestPayloadText] = useState("");
  const [testPayloadOpen, setTestPayloadOpen] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const signupPreviewJson = useMemo(
    () => buildSignupPayloadPreviewJson(signupFieldMap),
    [signupFieldMap],
  );
  const signupMapReady = isSignupFieldMapReady(signupFieldMap);
  const signupFieldMapIssues = useMemo(
    () => getSignupFieldMapIssues(signupFieldMap),
    [signupFieldMap],
  );

  useEffect(() => {
    if (!data) return;
    setHost(data.host || "");
    setAcademy(data.academy || "");
    setLoginUrl(data.login?.url || "");
    setLoginPath(data.login?.path || "");
    setLoginMethod(asMethod(data.login?.method, "POST"));
    setLoginPayloadText(
      data.login?.payload
        ? JSON.stringify(data.login.payload, null, 2)
        : DEFAULT_LOGIN_PAYLOAD_TEXT,
    );
    setSignupPath(data.signup?.path || "");
    setSignupMethod(asMethod(data.signup?.method, "POST"));
    setSignupFieldMap(
      data.signup?.field_map?.length
        ? data.signup.field_map.map((e) => ({ ...e }))
        : [...DEFAULT_AUTH_SIGNUP_FIELD_MAP],
    );
    setProfilePath(data.profile?.path || "");
    setProfileMethod(asMethod(data.profile?.method, "GET"));
    setLoginPayloadError(null);
    setDirty(false);
  }, [data]);

  const markDirty = () => setDirty(true);

  const replaceSignupFieldMapRow = (index: number, next: AuthSignupFieldMapEntry) => {
    setSignupFieldMap((prev) => prev.map((row, i) => (i === index ? next : row)));
    markDirty();
  };

  const setSignupRowKey = (index: number, key: string) => {
    setSignupFieldMap((prev) =>
      prev.map((row, i) => (i === index ? { ...row, key } : row)),
    );
    markDirty();
  };

  const setSignupRowMode = (index: number, mode: SignupSourceMode) => {
    setSignupFieldMap((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const key = row.key;
        if (mode === "constant") return { key, constant: "" };
        if (mode === "global") return { key, global: "" };
        return { key, from: "form.email" };
      }),
    );
    markDirty();
  };

  const addSignupFieldMapRow = () => {
    setSignupFieldMap((prev) => [...prev, { key: "", from: "form.email" }]);
    markDirty();
  };

  const removeSignupFieldMapRow = (index: number) => {
    setSignupFieldMap((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  };

  const parsePayload = (
    text: string,
    setError: (msg: string | null) => void,
  ): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Payload must be a JSON object");
        return null;
      }
      setError(null);
      return parsed as Record<string, unknown>;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
      return null;
    }
  };

  const handleSave = async () => {
    const loginPayload = parsePayload(loginPayloadText, setLoginPayloadError);
    if (!loginPayload) {
      toast({
        title: "Invalid login payload",
        description: loginPayloadError || "Fix the JSON first",
        variant: "destructive",
      });
      setLoginPayloadOpen(true);
      return;
    }
    if (signupFieldMapIssues.size > 0) {
      const kinds = new Set(signupFieldMapIssues.values());
      if (kinds.has("empty_constant") || kinds.has("empty_global")) {
        toast({
          title: "Fix empty field map sources",
          description:
            "Fixed values cannot be blank, and every Global row needs a global.* variable selected.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Fix empty or duplicate payload keys",
        description: "Every signup field map row needs a unique non-empty payload key before saving.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/auth", {
        host: host.trim(),
        academy: academy.trim(),
        login: {
          url: loginUrl.trim(),
          path: loginPath.trim(),
          method: loginMethod,
          payload: loginPayload,
        },
        signup: {
          path: signupPath.trim(),
          method: signupMethod,
          field_map: signupFieldMap,
        },
        profile: {
          path: profilePath.trim(),
          method: profileMethod,
        },
      });
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/auth"] });
      toast({ title: "Auth settings saved" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save auth settings";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await apiRequest("PUT", "/api/settings/auth", null);
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/auth"] });
      toast({ title: "Auth settings cleared" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to clear auth settings";
      toast({ title: "Clear failed", description: message, variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  const openTest = (target: TestTarget) => {
    setTestTarget(target);
    setTestResult(null);
    setTestEmail("");
    setTestPassword("");
    setTestToken("");
    setTestPayloadOpen(false);
    setTestCallback(typeof window !== "undefined" ? window.location.href : "");
    if (target === "signup") {
      setTestPayloadText(
        JSON.stringify(buildSignupTestPayloadFromFieldMap(signupFieldMap), null, 2),
      );
    } else if (target === "login") {
      setTestPayloadText(loginPayloadText || DEFAULT_LOGIN_PAYLOAD_TEXT);
      try {
        const parsed = JSON.parse(loginPayloadText || "{}") as { email?: string; password?: string };
        setTestEmail(typeof parsed.email === "string" ? parsed.email : "");
        setTestPassword(typeof parsed.password === "string" ? parsed.password : "");
      } catch {
        // ignore
      }
    } else {
      setTestPayloadText("");
    }
  };

  const buildLoginRedirectUrl = (): string | null => {
    const base = loginUrl.trim();
    if (!base) return null;
    try {
      const url = new URL(base);
      const callback = testCallback.trim();
      if (callback) url.searchParams.set("url", callback);
      return url.toString();
    } catch {
      return null;
    }
  };

  const startLoginRedirect = () => {
    const dest = buildLoginRedirectUrl();
    if (!dest) {
      toast({
        title: "Invalid login URL",
        description: "Set a valid absolute login URL first.",
        variant: "destructive",
      });
      return;
    }
    window.location.href = dest;
  };

  const runTest = async () => {
    if (!testTarget || testTarget === "login_url") return;
    setTestRunning(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        target: testTarget,
        host: host.trim() || undefined,
        academy: academy.trim() || undefined,
        login: {
          url: loginUrl.trim() || undefined,
          path: loginPath.trim() || undefined,
          method: loginMethod,
        },
        signup: {
          path: signupPath.trim() || undefined,
          method: signupMethod,
        },
        profile: {
          path: profilePath.trim() || undefined,
          method: profileMethod,
        },
      };

      if (testTarget === "login") {
        body.email = testEmail.trim();
        body.password = testPassword;
        try {
          const parsed = JSON.parse(testPayloadText || loginPayloadText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            body.payload = parsed;
          }
        } catch {
          // email/password fields still apply
        }
      }
      if (testTarget === "profile") {
        body.token = testToken.trim();
      }
      if (testTarget === "signup") {
        try {
          const parsed = JSON.parse(testPayloadText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Payload must be a JSON object");
          }
          body.payload = parsed;
        } catch (err) {
          setTestResult({
            ok: false,
            error: err instanceof Error ? err.message : "Invalid payload JSON",
          });
          return;
        }
      }

      const res = await fetch("/api/settings/auth/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: TestResult;
      try {
        json = JSON.parse(text) as TestResult;
      } catch {
        setTestResult({
          ok: false,
          status: res.status,
          error:
            `Expected JSON from /api/settings/auth/test but got ${res.headers.get("content-type") || "unknown"} (HTTP ${res.status}). ` +
            "Often this means the server returned an HTML error/SPA page — restart `npm run dev` if the auth/test route is new.",
          body: text.slice(0, 800),
        });
        return;
      }
      setTestResult(json);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, error: message });
    } finally {
      setTestRunning(false);
    }
  };

  const hasAnyValue = Boolean(host || academy || loginUrl || loginPath || signupPath || profilePath);
  const testTitle =
    testTarget === "login_url"
      ? "Test Login URL"
      : testTarget === "login"
        ? "Test Login Path"
        : testTarget === "signup"
          ? "Test Signup Path"
          : testTarget === "profile"
            ? "Test Profile Path"
            : "Test";

  const payloadErrors = Boolean(loginPayloadError);

  return (
    <>
      <Card className="pb-20" data-testid="auth-settings-panel">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconUserCheck className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Signup & Login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Consumer authentication for real website visitors — not staff users.
                  Site-wide contract used by forms with <strong>Require Signup</strong> enabled.
                  Guests are registered through the signup endpoint; logged-in users skip fields
                  already known from their profile. Stored in{" "}
                  <code className="text-xs">settings.yml</code> under{" "}
                  <code className="text-xs">auth</code>.
                </p>
              </div>

              {data?.signup_configured ? (
                <div className="flex items-start gap-2 rounded-md border border-status-online/40 bg-status-online/5 p-3 text-sm">
                  <IconCircleCheck className="h-4 w-4 mt-0.5 shrink-0 text-status-online" />
                  <span data-testid="text-auth-configured">
                    Signup is configured — forms can enable "Require Signup".
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <IconAlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                  <span data-testid="text-auth-not-configured">
                    Signup is not configured. Set a host (or rely on the BreatheCode env default)
                    and a signup path so forms can enable "Require Signup".
                  </span>
                </div>
              )}

              <Card data-testid="card-auth-connection">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Connection</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Shared API host and optional academy for consumer auth requests.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 min-w-0">
                      <Label htmlFor="auth-host" className="text-sm font-medium">
                        API host
                      </Label>
                      <Input
                        id="auth-host"
                        value={host}
                        onChange={(e) => {
                          setHost(e.target.value);
                          markDirty();
                        }}
                        placeholder="https://breathecode.herokuapp.com"
                        className="font-mono text-sm"
                        data-testid="input-auth-host"
                      />
                      <p className="text-xs text-muted-foreground">
                        Shared base for login/signup/profile paths. Falls back to{" "}
                        <code className="text-xs">VITE_BREATHECODE_HOST</code> when empty.
                      </p>
                    </div>
                    <div className="space-y-1.5 min-w-0">
                      <Label htmlFor="auth-academy" className="text-sm font-medium">
                        Academy ID
                      </Label>
                      <Input
                        id="auth-academy"
                        value={academy}
                        onChange={(e) => {
                          setAcademy(e.target.value);
                          markDirty();
                        }}
                        placeholder="4"
                        className="font-mono text-sm"
                        data-testid="input-auth-academy"
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional. When set, sent as the <code className="text-xs">Academy</code>{" "}
                        header on profile requests (e.g.{" "}
                        <code className="text-xs">/v1/auth/user/me</code>).
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card data-testid="card-auth-login">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <IconLogin2 className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">Login</CardTitle>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Hosted login page, API login path, and profile fetch for logged-in users.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="auth-login-url" className="text-sm font-medium">
                          Login URL
                        </Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openTest("login_url")}
                          disabled={!loginUrl.trim()}
                          data-testid="button-test-login-url"
                        >
                          <IconSend className="h-3.5 w-3.5 mr-1" />
                          Test
                        </Button>
                      </div>
                      <Input
                        id="auth-login-url"
                        value={loginUrl}
                        onChange={(e) => {
                          setLoginUrl(e.target.value);
                          markDirty();
                        }}
                        placeholder="https://breathecode.herokuapp.com/v1/auth/view/login"
                        className="font-mono text-sm"
                        data-testid="input-auth-login-url"
                      />
                      <p className="text-xs text-muted-foreground">
                        Hosted login page; redirects back with <code className="text-xs">?token=</code>.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="auth-login-path" className="text-sm font-medium">
                          Login path
                        </Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openTest("login")}
                          disabled={!loginPath.trim()}
                          data-testid="button-test-login-path"
                        >
                          <IconSend className="h-3.5 w-3.5 mr-1" />
                          Test
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <MethodSelect
                          value={loginMethod}
                          onChange={(m) => {
                            setLoginMethod(m);
                            markDirty();
                          }}
                          testId="select-auth-login-method"
                          ariaLabel="Login HTTP method"
                        />
                        <Input
                          id="auth-login-path"
                          value={loginPath}
                          onChange={(e) => {
                            setLoginPath(e.target.value);
                            markDirty();
                          }}
                          placeholder="/v1/auth/login/"
                          className="font-mono text-sm"
                          data-testid="input-auth-login-path"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        API login endpoint and method (relative to host, or absolute URL).
                      </p>

                      <Collapsible open={loginPayloadOpen} onOpenChange={setLoginPayloadOpen}>
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted/40"
                            data-testid="button-toggle-login-payload"
                          >
                            <span className="font-medium">Example login payload</span>
                            <IconChevronDown
                              className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform",
                                loginPayloadOpen && "rotate-180",
                              )}
                            />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2 space-y-1.5">
                          <div
                            className="min-w-0 w-full max-w-full overflow-hidden rounded-md border border-input"
                            data-testid="textarea-auth-login-payload"
                          >
                            <CodeMirror
                              value={loginPayloadText}
                              height="160px"
                              width="100%"
                              extensions={[jsonLang(), EditorView.lineWrapping]}
                              theme={oneDark}
                              onChange={(value) => {
                                setLoginPayloadText(value);
                                parsePayload(value, setLoginPayloadError);
                                markDirty();
                              }}
                              basicSetup={{
                                lineNumbers: true,
                                foldGutter: true,
                                highlightActiveLine: true,
                              }}
                              className="min-w-0 max-w-full text-xs [&_.cm-editor]:max-w-full [&_.cm-editor]:rounded-md [&_.cm-scroller]:overflow-auto"
                            />
                          </div>
                          {loginPayloadError ? (
                            <p className="text-xs text-destructive" data-testid="text-auth-login-payload-error">
                              {loginPayloadError}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Example body for API login Test (typically email + password).
                            </p>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="auth-profile-path" className="text-sm font-medium">
                          Profile path
                        </Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openTest("profile")}
                          disabled={!profilePath.trim() && !host.trim()}
                          data-testid="button-test-me-path"
                        >
                          <IconSend className="h-3.5 w-3.5 mr-1" />
                          Test
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <MethodSelect
                          value={profileMethod}
                          onChange={(m) => {
                            setProfileMethod(m);
                            markDirty();
                          }}
                          testId="select-auth-profile-method"
                          ariaLabel="Profile HTTP method"
                        />
                        <Input
                          id="auth-profile-path"
                          value={profilePath}
                          onChange={(e) => {
                            setProfilePath(e.target.value);
                            markDirty();
                          }}
                          placeholder="/v1/auth/user/me"
                          className="font-mono text-sm"
                          data-testid="input-auth-me-path"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Endpoint used to fetch the logged-in user's profile.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="card-auth-signup">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <IconUserPlus className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">Signup</CardTitle>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Keys sent when a form has Require Signup. Map each key to a form or session
                      value. Mark required only for form sources — every signup form must then
                      require that field.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="auth-signup-path" className="text-sm font-medium">
                          Signup path
                        </Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openTest("signup")}
                          disabled={!signupPath.trim()}
                          data-testid="button-test-signup-path"
                        >
                          <IconSend className="h-3.5 w-3.5 mr-1" />
                          Test
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <MethodSelect
                          value={signupMethod}
                          onChange={(m) => {
                            setSignupMethod(m);
                            markDirty();
                          }}
                          testId="select-auth-signup-method"
                          ariaLabel="Signup HTTP method"
                        />
                        <Input
                          id="auth-signup-path"
                          value={signupPath}
                          onChange={(e) => {
                            setSignupPath(e.target.value);
                            markDirty();
                          }}
                          placeholder="/v1/auth/subscribe/"
                          className="font-mono text-sm"
                          data-testid="input-auth-signup-path"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Relative to the host, or an absolute URL.
                      </p>
                    </div>

                    {signupPath.trim() && !signupMapReady ? (
                      <div
                        className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs"
                        data-testid="text-auth-signup-map-empty"
                      >
                        <IconAlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                        <span>
                          Add at least one field mapping below. Forms cannot enable Require Signup
                          until the map has rows.
                        </span>
                      </div>
                    ) : null}

                    <div className="space-y-2" data-testid="auth-signup-field-map">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-sm font-medium">Field map</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addSignupFieldMapRow}
                          data-testid="button-auth-signup-add-field"
                        >
                          <IconPlus className="h-3.5 w-3.5 mr-1" />
                          Add field
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground" data-testid="text-auth-signup-field-map-intro">
                        Maps each signup API payload key to a form field, session value, fixed
                        string, or site global. Forms cannot enable Require Signup until this map
                        has at least one row.
                      </p>
                      <div className="space-y-1">
                        {signupFieldMap.map((row, index) => {
                          const mode = signupRowMode(row);
                          const formFrom =
                            isDynamicFromEntry(row) && isFormSource(row.from);
                          const issue = signupFieldMapIssues.get(index);
                          const required =
                            isDynamicFromEntry(row) &&
                            formFrom &&
                            row.required === true;
                          const globalUnknown =
                            isGlobalEntry(row) &&
                            !!row.global.trim() &&
                            !!variableDefinitions &&
                            !(row.global in variableDefinitions);
                          return (
                            <div
                              key={index}
                              className="space-y-0.5"
                              data-testid={`auth-signup-field-row-${index}`}
                            >
                              <div className="flex items-center gap-2">
                                <ClickToEditPayloadKey
                                  index={index}
                                  value={row.key}
                                  hasIssue={issue === "blank" || issue === "duplicate"}
                                  onChange={(key) => setSignupRowKey(index, key)}
                                />
                                <IconArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <Select
                                  value={mode}
                                  onValueChange={(v) => {
                                    if (v === "from" || v === "constant" || v === "global") {
                                      setSignupRowMode(index, v);
                                    }
                                  }}
                                >
                                  <SelectTrigger
                                    className="h-7 w-[6.5rem] shrink-0 text-xs"
                                    data-testid={`select-auth-signup-mode-${index}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="from">Form/Session</SelectItem>
                                    <SelectItem value="constant">Fixed</SelectItem>
                                    <SelectItem value="global">Global</SelectItem>
                                  </SelectContent>
                                </Select>
                                {mode === "from" && isDynamicFromEntry(row) ? (
                                  <SignupFromCombobox
                                    index={index}
                                    value={row.from}
                                    onChange={(from) =>
                                      replaceSignupFieldMapRow(index, {
                                        key: row.key,
                                        from,
                                        ...(isFormSource(from) && row.required
                                          ? { required: true }
                                          : {}),
                                      })
                                    }
                                  />
                                ) : null}
                                {mode === "constant" && isConstantEntry(row) ? (
                                  <Input
                                    value={row.constant}
                                    onChange={(e) =>
                                      replaceSignupFieldMapRow(index, {
                                        key: row.key,
                                        constant: e.target.value,
                                      })
                                    }
                                    placeholder="fixed value"
                                    className={cn(
                                      "h-7 flex-1 min-w-0 font-mono text-xs",
                                      issue === "empty_constant" && "border-amber-500/50",
                                    )}
                                    data-testid={`input-auth-signup-constant-${index}`}
                                  />
                                ) : null}
                                {mode === "global" && isGlobalEntry(row) ? (
                                  <SignupGlobalCombobox
                                    index={index}
                                    value={row.global}
                                    globalNames={globalVarNames}
                                    unknown={globalUnknown}
                                    onChange={(global) =>
                                      replaceSignupFieldMapRow(index, {
                                        key: row.key,
                                        global,
                                      })
                                    }
                                  />
                                ) : null}
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex flex-shrink-0">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className={cn(
                                            "h-7 w-7",
                                            required && "text-primary",
                                          )}
                                          disabled={!formFrom}
                                          onClick={() => {
                                            if (!isDynamicFromEntry(row) || !formFrom) return;
                                            replaceSignupFieldMapRow(index, {
                                              key: row.key,
                                              from: row.from,
                                              ...(required ? {} : { required: true }),
                                            });
                                          }}
                                          data-testid={`switch-auth-signup-required-${index}`}
                                          aria-label={
                                            formFrom
                                              ? required
                                                ? "Required on signup forms"
                                                : "Mark required on signup forms"
                                              : "Only for form.* sources"
                                          }
                                        >
                                          <IconAsterisk className="h-3.5 w-3.5" />
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">
                                      {formFrom
                                        ? required
                                          ? "Required on signup forms"
                                          : "Mark required on signup forms"
                                        : "Only for form.* sources"}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 flex-shrink-0"
                                  onClick={() => removeSignupFieldMapRow(index)}
                                  data-testid={`button-auth-signup-remove-${index}`}
                                >
                                  <IconTrash className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              {issue === "blank" ? (
                                <p
                                  className="text-[10px] text-amber-600 dark:text-amber-400 ml-[7.5rem]"
                                  data-testid={`text-auth-signup-key-blank-${index}`}
                                >
                                  Payload key is required
                                </p>
                              ) : null}
                              {issue === "duplicate" ? (
                                <p
                                  className="text-[10px] text-amber-600 dark:text-amber-400 ml-[7.5rem]"
                                  data-testid={`text-auth-signup-key-duplicate-${index}`}
                                >
                                  Duplicate payload key
                                </p>
                              ) : null}
                              {issue === "empty_constant" ? (
                                <p
                                  className="text-[10px] text-amber-600 dark:text-amber-400 ml-[7.5rem]"
                                  data-testid={`text-auth-signup-constant-empty-${index}`}
                                >
                                  Fixed value cannot be empty
                                </p>
                              ) : null}
                              {issue === "empty_global" ? (
                                <p
                                  className="text-[10px] text-amber-600 dark:text-amber-400 ml-[7.5rem]"
                                  data-testid={`text-auth-signup-global-empty-${index}`}
                                >
                                  Select a global.* variable
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                        {signupFieldMap.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">
                            No mappings yet. Add a field to build the signup payload.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <Collapsible open={signupPreviewOpen} onOpenChange={setSignupPreviewOpen}>
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hover-elevate rounded w-full text-left"
                          data-testid="button-toggle-signup-payload-preview"
                        >
                          {signupPreviewOpen ? (
                            <IconChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <IconChevronDown className="h-3.5 w-3.5 -rotate-90" />
                          )}
                          Example signup payload
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2">
                        <div
                          className="min-w-0 w-full max-w-full overflow-hidden rounded-md border border-input"
                          data-testid="preview-auth-signup-payload"
                        >
                          <CodeMirror
                            value={signupPreviewJson}
                            height="280px"
                            width="100%"
                            editable={false}
                            extensions={[
                              jsonLang(),
                              EditorView.lineWrapping,
                              ...createVariableWidgetPlugin({ readOnly: true }),
                            ]}
                            theme={oneDark}
                            basicSetup={{
                              lineNumbers: true,
                              foldGutter: true,
                              highlightActiveLine: false,
                            }}
                            className="min-w-0 max-w-full text-xs [&_.cm-editor]:max-w-full [&_.cm-editor]:rounded-md [&_.cm-scroller]:overflow-auto"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground" data-testid="text-auth-conversion-info-note">
                          Auto-generated from the field map (read-only).{" "}
                          <code className="text-xs">conversion_info</code> is always built and
                          appended automatically at submit time — the sample object above is for
                          illustration only.
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-lg"
        data-testid="auth-save-bar"
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-end gap-3">
          <p
            className="text-xs text-muted-foreground min-w-0 truncate text-right"
            data-testid="text-auth-save-status"
          >
            {saving
              ? "Saving…"
              : dirty
                ? payloadErrors
                  ? "Fix login payload JSON before saving"
                  : signupFieldMapIssues.size > 0
                    ? "Fix field map issues before saving"
                    : "Unsaved changes"
                : "All changes saved"}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {hasAnyValue && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                disabled={clearing || saving}
                data-testid="button-clear-auth"
              >
                {clearing ? (
                  <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <IconTrash className="h-4 w-4 mr-1.5" />
                )}
                Clear
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saving || payloadErrors || signupFieldMapIssues.size > 0}
              data-testid="button-save-auth"
            >
              {saving ? (
                <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={!!testTarget} onOpenChange={(open) => !open && setTestTarget(null)}>
        <DialogContent
          className="max-w-lg max-h-[90vh] min-w-0 overflow-y-auto"
          data-testid="dialog-auth-test"
        >
          <DialogHeader>
            <DialogTitle>{testTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1 min-w-0 overflow-x-hidden">
            {testTarget === "login_url" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground" data-testid="text-auth-test-login-url-help">
                  The login URL is not an API endpoint — it redirects the visitor to the hosted
                  login page. After they sign in, BreatheCode sends them back to the callback
                  URL (appended as <code className="text-xs">?url=</code>), typically with a{" "}
                  <code className="text-xs">?token=</code> query param.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="test-callback">Temporary callback URL</Label>
                  <Input
                    id="test-callback"
                    value={testCallback}
                    onChange={(e) => setTestCallback(e.target.value)}
                    placeholder="https://yoursite.com/private/security/auth"
                    className="font-mono text-sm"
                    data-testid="input-auth-test-callback"
                  />
                  <p className="text-xs text-muted-foreground">
                    Where to return after login. Defaults to this security page.
                  </p>
                </div>
                {buildLoginRedirectUrl() && (
                  <p className="text-xs font-mono break-all text-muted-foreground" data-testid="text-auth-test-redirect-preview">
                    {buildLoginRedirectUrl()}
                  </p>
                )}
              </div>
            )}

            {testTarget === "login" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sends credentials to the login API path using the configured method ({loginMethod}).
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="test-email">Email</Label>
                  <Input
                    id="test-email"
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    data-testid="input-auth-test-email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="test-password">Password</Label>
                  <Input
                    id="test-password"
                    type="password"
                    value={testPassword}
                    onChange={(e) => setTestPassword(e.target.value)}
                    data-testid="input-auth-test-password"
                  />
                </div>
              </div>
            )}

            {testTarget === "profile" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Calls the profile path ({profileMethod}) with an Authorization token.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="test-token">Token</Label>
                  <Input
                    id="test-token"
                    value={testToken}
                    onChange={(e) => setTestToken(e.target.value)}
                    placeholder="Paste a BreatheCode token"
                    className="font-mono text-sm"
                    data-testid="input-auth-test-token"
                  />
                </div>
              </div>
            )}

            {testTarget === "signup" && (
              <div className="space-y-3 min-w-0">
                <p className="text-sm text-muted-foreground break-words">
                  Sends this payload to the signup path ({signupMethod}). Edit freely for the test —
                  it does not change saved settings.
                </p>
                <Collapsible open={testPayloadOpen} onOpenChange={setTestPayloadOpen}>
                  {!testPayloadOpen ? (
                    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3">
                      <pre
                        className="min-w-0 flex-1 text-xs font-mono text-muted-foreground overflow-hidden line-clamp-3 whitespace-pre-wrap break-all"
                        data-testid="text-auth-test-payload-preview"
                      >
                        {testPayloadText || "{}"}
                      </pre>
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          data-testid="button-edit-auth-test-payload"
                        >
                          <IconPencil className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">Test payload</span>
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="button-collapse-auth-test-payload"
                        >
                          <IconChevronDown className="h-3.5 w-3.5 mr-1 rotate-180" />
                          Done
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  )}
                  <CollapsibleContent className="pt-2">
                    <div
                      className="min-w-0 w-full max-w-full overflow-hidden rounded-md border border-input"
                      data-testid="textarea-auth-test-payload"
                    >
                      <CodeMirror
                        value={testPayloadText}
                        height="280px"
                        width="100%"
                        extensions={[jsonLang(), EditorView.lineWrapping]}
                        theme={oneDark}
                        onChange={setTestPayloadText}
                        basicSetup={{
                          lineNumbers: true,
                          foldGutter: true,
                          highlightActiveLine: true,
                        }}
                        className="min-w-0 max-w-full text-xs [&_.cm-editor]:max-w-full [&_.cm-editor]:rounded-md [&_.cm-scroller]:overflow-auto"
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}

            {testResult && testTarget !== "login_url" && (
              <div className="space-y-2" data-testid="auth-test-result">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={testResult.ok ? "default" : "destructive"} data-testid="badge-auth-test-status">
                    {testResult.ok ? "OK" : "Failed"}
                    {typeof testResult.status === "number" ? ` · HTTP ${testResult.status}` : ""}
                  </Badge>
                  {typeof testResult.elapsed_ms === "number" && (
                    <span className="text-xs text-muted-foreground">{testResult.elapsed_ms} ms</span>
                  )}
                </div>
                {testResult.url && (
                  <p className="text-xs font-mono break-all text-muted-foreground">
                    {testResult.method || "GET"} {testResult.url}
                  </p>
                )}
                <pre
                  className="rounded-md border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64"
                  data-testid="text-auth-test-log"
                >
                  {formatLog(testResult)}
                </pre>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestTarget(null)} data-testid="button-auth-test-close">
              Close
            </Button>
            {testTarget === "login_url" ? (
              <Button
                onClick={startLoginRedirect}
                disabled={!loginUrl.trim() || !testCallback.trim()}
                data-testid="button-auth-test-redirect"
              >
                <IconExternalLink className="h-4 w-4 mr-1.5" />
                Start redirect
              </Button>
            ) : (
              <Button onClick={runTest} disabled={testRunning} data-testid="button-auth-test-run">
                {testRunning ? (
                  <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <IconSend className="h-4 w-4 mr-1.5" />
                )}
                Run test
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
