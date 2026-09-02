import { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
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
  isFormSource,
  isSignupFieldMapReady,
  type AuthSignupFieldMapEntry,
} from "@shared/authSignupFieldMap";

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

export function AuthTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<AuthSettingsResponse>({
    queryKey: ["/api/settings/auth"],
  });

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

  const updateSignupFieldMapRow = (
    index: number,
    patch: Partial<AuthSignupFieldMapEntry>,
  ) => {
    setSignupFieldMap((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        if (!isFormSource(next.from)) {
          delete next.required;
        }
        return next;
      }),
    );
    markDirty();
  };

  const addSignupFieldMapRow = () => {
    setSignupFieldMap((prev) => [
      ...prev,
      { key: "", from: "form.email" },
    ]);
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
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconUserCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Signup & Login</CardTitle>
          </div>
          <div className="flex items-center gap-2">
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
              disabled={!dirty || saving || payloadErrors}
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

              <div className="space-y-1.5 max-w-xl">
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

              <div className="space-y-1.5 max-w-xl">
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
                  Optional. When set, sent as the <code className="text-xs">Academy</code> header
                  on profile requests (e.g. <code className="text-xs">/v1/auth/user/me</code>).
                </p>
              </div>

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
                      <div className="space-y-2">
                        {signupFieldMap.map((row, index) => {
                          const formFrom = isFormSource(row.from);
                          return (
                            <div
                              key={index}
                              className="rounded-md border p-2 space-y-2"
                              data-testid={`auth-signup-field-row-${index}`}
                            >
                              <div className="flex gap-2 items-start">
                                <div className="flex-1 space-y-1 min-w-0">
                                  <Label className="text-xs text-muted-foreground">Payload key</Label>
                                  <Input
                                    value={row.key}
                                    onChange={(e) =>
                                      updateSignupFieldMapRow(index, { key: e.target.value })
                                    }
                                    placeholder="plan"
                                    className="font-mono text-sm h-8"
                                    data-testid={`input-auth-signup-key-${index}`}
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0 mt-5"
                                  onClick={() => removeSignupFieldMapRow(index)}
                                  data-testid={`button-auth-signup-remove-${index}`}
                                >
                                  <IconTrash className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">From</Label>
                                <Select
                                  value={row.from}
                                  onValueChange={(v) =>
                                    updateSignupFieldMapRow(index, { from: v })
                                  }
                                >
                                  <SelectTrigger
                                    className="font-mono text-xs h-8"
                                    data-testid={`select-auth-signup-from-${index}`}
                                  >
                                    <SelectValue placeholder="form.email" />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-72">
                                    <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">
                                      Form
                                    </div>
                                    {AUTH_SIGNUP_FORM_FIELD_PRESETS.map((name) => (
                                      <SelectItem
                                        key={`form.${name}`}
                                        value={`form.${name}`}
                                        className="font-mono text-xs"
                                      >
                                        form.{name}
                                      </SelectItem>
                                    ))}
                                    <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">
                                      Session
                                    </div>
                                    {AUTH_SIGNUP_SESSION_FIELD_PRESETS.map((name) => (
                                      <SelectItem
                                        key={`session.${name}`}
                                        value={`session.${name}`}
                                        className="font-mono text-xs"
                                      >
                                        session.{name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Input
                                  value={row.from}
                                  onChange={(e) =>
                                    updateSignupFieldMapRow(index, { from: e.target.value })
                                  }
                                  placeholder="form.custom_field or session.geo.country"
                                  className="font-mono text-xs h-8"
                                  data-testid={`input-auth-signup-from-custom-${index}`}
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  Pick a preset or type a custom form.* / session.* path.
                                </p>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <Label
                                  htmlFor={`auth-signup-required-${index}`}
                                  className={cn(
                                    "text-xs",
                                    !formFrom && "text-muted-foreground",
                                  )}
                                >
                                  Required on signup forms
                                </Label>
                                <Switch
                                  id={`auth-signup-required-${index}`}
                                  checked={formFrom && row.required === true}
                                  disabled={!formFrom}
                                  onCheckedChange={(checked) =>
                                    updateSignupFieldMapRow(index, {
                                      required: checked || undefined,
                                    })
                                  }
                                  data-testid={`switch-auth-signup-required-${index}`}
                                />
                              </div>
                            </div>
                          );
                        })}
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
