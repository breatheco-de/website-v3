import { useState, useEffect, useRef } from "react";
import {
  IconArrowLeft,
  IconCheck,
  IconCode,
  IconLanguage,
  IconLoader2,
  IconPlus,
  IconStar,
  IconTrash,
  IconDeviceFloppy,
  IconPlayerPlay,
  IconAlertCircle,
  IconPhoto,
  IconChartBar,
  IconInfoCircle,
  IconScale,
  IconMessage,
  IconServer,
  IconRobot,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { BRAND_LOGO_ENSURE_TAGS, OG_IMAGE_ENSURE_TAGS } from "@shared/standardMediaTags";
import { ImagePickerDialog } from "@/components/editing/ImagePickerDialog";
import { LinkPicker } from "@/components/editing/LinkPicker";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RichTextArea } from "@/components/editing/RichTextArea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ServerTab } from "@/components/settings/ServerTab";
import { RobotsTab } from "@/components/settings/RobotsTab";
import {
  consentLabelFromKey,
  getBuiltinConsentFallback,
  isBlankConsentHtml,
  isBuiltinConsentKey,
  parseConsentSettingsResponse,
  slugifyConsentKey,
  stripConsentHtml,
} from "@shared/consent-settings";

const SETTINGS_TABS = ["locales", "migrations", "brand", "robots", "legal", "server"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function resolveSettingsTab(search: string): SettingsTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab && (SETTINGS_TABS as readonly string[]).includes(tab)) {
    return tab as SettingsTab;
  }
  return "locales";
}

interface LocaleEntry {
  code: string;
  label: string;
}

interface LocaleSettings {
  default_locale: string;
  supported_locales: LocaleEntry[];
}

interface Migration {
  filename: string;
  name: string;
  description: string;
}

interface MigrationRowState {
  running: boolean;
  result: { success: boolean; output: string } | null;
}


interface BrandSettings {
  title: string;
  logo: string;
  logo_dark: string;
  logo_src: string;
  logo_dark_src: string;
  default_social_image: string;
  twitter_handle: string;
  linkedin: string;
  facebook: string;
  youtube: string;
  instagram: string;
  github: string;
  unknown_same_as: string[];
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { hasCapability, isValidated } = useDebugAuth();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveSettingsTab(searchString));

  useEffect(() => {
    const tab = new URLSearchParams(searchString).get("tab");
    if (tab === "auth") {
      setLocation("/private/security/auth");
      return;
    }
    setActiveTab(resolveSettingsTab(searchString));
  }, [searchString, setLocation]);

  const { data, isLoading } = useQuery<LocaleSettings>({
    queryKey: ["/api/settings/locales"],
  });

  const { data: migrations, isLoading: migrationsLoading } = useQuery<Migration[]>({
    queryKey: ["/api/migrations"],
  });

  const { data: brandData, isLoading: brandLoading } = useQuery<BrandSettings>({
    queryKey: ["/api/admin/brand-settings"],
    enabled: isValidated === true,
  });

  const [locales, setLocales] = useState<LocaleEntry[]>([]);
  const [defaultLocale, setDefaultLocale] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [migrationStates, setMigrationStates] = useState<Record<string, MigrationRowState>>({});
  const [brandImagePickerOpen, setBrandImagePickerOpen] = useState(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [logoDarkPickerOpen, setLogoDarkPickerOpen] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandTitle, setBrandTitle] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [twitterHandle, setTwitterHandle] = useState("");
  const [twitterSaving, setTwitterSaving] = useState(false);
  const [socialLinks, setSocialLinks] = useState({ linkedin: "", facebook: "", youtube: "", instagram: "", github: "" });
  const [socialSaving, setSocialSaving] = useState<string | null>(null);
  const [socialErrors, setSocialErrors] = useState<Record<string, string | null>>({});

  const SOCIAL_DOMAINS: Record<string, string> = {
    linkedin: "linkedin.com",
    facebook: "facebook.com",
    youtube: "youtube.com",
    instagram: "instagram.com",
    github: "github.com",
  };

  function validateSocialUrl(key: string, value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return "Not a valid URL — make sure it starts with https://";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "URL must start with https://";
    }
    const expectedDomain = SOCIAL_DOMAINS[key];
    if (expectedDomain && !parsed.hostname.endsWith(expectedDomain)) {
      return `This doesn't look like a ${key.charAt(0).toUpperCase() + key.slice(1)} URL (expected ${expectedDomain})`;
    }
    return null;
  }

  const canEditSeo = hasCapability("seo_settings");

  interface LegalSettings {
    legal_terms_url: string;
    legal_privacy_url: string;
  }

  const { data: legalData, isLoading: legalLoading } = useQuery<LegalSettings>({
    queryKey: ["/api/settings/legal"],
  });

  const [legalTermsUrl, setLegalTermsUrl] = useState("");
  const [legalPrivacyUrl, setLegalPrivacyUrl] = useState("");
  const [legalSaving, setLegalSaving] = useState<string | null>(null);

  const { data: consentDataRaw, refetch: refetchConsent } = useQuery({
    queryKey: ["/api/settings/consent"],
  });
  const { fallback: consentFallback, messages: consentData } = parseConsentSettingsResponse(consentDataRaw);

  const supportedLocalesForConsent = data?.supported_locales?.length
    ? data.supported_locales
    : [{ code: "en", label: "English" }, { code: "es", label: "Spanish" }];
  const defaultLocaleForConsent = data?.default_locale || supportedLocalesForConsent[0]?.code || "en";

  const consentKeys = Object.keys(consentData ?? {});

  const [editingConsent, setEditingConsent] = useState<{
    mode: "add" | "edit";
    key: string;
    nameInput: string;
    locales: Record<string, string>;
  } | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [fallbackSaving, setFallbackSaving] = useState(false);
  const ignoreConsentDialogCloseRef = useRef(false);

  function markConsentPopoverInteract() {
    ignoreConsentDialogCloseRef.current = true;
    requestAnimationFrame(() => {
      ignoreConsentDialogCloseRef.current = false;
    });
  }

  function emptyLocaleMap(): Record<string, string> {
    const next: Record<string, string> = {};
    for (const loc of supportedLocalesForConsent) next[loc.code] = "";
    return next;
  }

  function openAddConsent() {
    setEditingConsent({
      mode: "add",
      key: "",
      nameInput: "",
      locales: emptyLocaleMap(),
    });
  }

  function openEditConsent(key: string) {
    const stored = consentData?.[key] ?? {};
    const locales = emptyLocaleMap();
    for (const loc of supportedLocalesForConsent) {
      const storedText = stored[loc.code] ?? "";
      locales[loc.code] = isBlankConsentHtml(storedText)
        ? getBuiltinConsentFallback(key, loc.code)
        : storedText;
    }
    setEditingConsent({
      mode: "edit",
      key,
      nameInput: consentLabelFromKey(key),
      locales,
    });
  }

  const editingConsentKey = editingConsent
    ? editingConsent.mode === "add"
      ? slugifyConsentKey(editingConsent.nameInput)
      : editingConsent.key
    : "";

  async function handleConsentSave() {
    if (!editingConsent) return;
    const key = editingConsentKey;
    if (!key) {
      toast({ title: "Name required", description: "Enter a name so we can create consent_<name>.", variant: "destructive" });
      return;
    }
    if (editingConsent.mode === "add" && consentKeys.includes(key)) {
      toast({ title: "Already exists", description: `${key} is already in the list. Edit that row instead.`, variant: "destructive" });
      return;
    }
    setConsentSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/consent", {
        key,
        locales: editingConsent.locales,
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      await refetchConsent();
      setEditingConsent(null);
      toast({ title: "Saved", description: `${consentLabelFromKey(key)} consent message updated.` });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setConsentSaving(false);
    }
  }

  async function handleConsentFallbackToggle(key: string, on: boolean) {
    setFallbackSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/consent/fallback", {
        fallback: on ? key : null,
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      await refetchConsent();
      toast({
        title: "Saved",
        description: on
          ? `${consentLabelFromKey(key)} is the form default when no channels are on.`
          : "No form default — forms with no channels will not show an extra checkbox.",
      });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setFallbackSaving(false);
    }
  }

  function validateLegalUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return "URL must start with https://";
      }
    } catch {
      // Allow relative paths like /en/terms-conditions
      if (!trimmed.startsWith("/")) {
        return "Enter a full URL (https://...) or a relative path starting with /";
      }
    }
    return null;
  }

  async function handleLegalSave(field: "legal_terms_url" | "legal_privacy_url", newValue?: string) {
    const value = newValue !== undefined ? newValue : (field === "legal_terms_url" ? legalTermsUrl : legalPrivacyUrl);
    setLegalSaving(field);
    try {
      const err = validateLegalUrl(value);
      if (err) {
        toast({ title: "Invalid URL", description: err, variant: "destructive" });
        return;
      }
      const res = await apiRequest("PUT", "/api/settings/legal", { [field]: value.trim() });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/legal"] });
      toast({ title: "Saved", description: "Legal URL updated." });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setLegalSaving(null);
    }
  }

  useEffect(() => {
    if (data) {
      setLocales(data.supported_locales.map((l) => ({ ...l })));
      setDefaultLocale(data.default_locale);
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    if (brandData) {
      setBrandTitle(brandData.title ?? "");
      setTwitterHandle(brandData.twitter_handle ?? "");
      setSocialLinks({
        linkedin: brandData.linkedin ?? "",
        facebook: brandData.facebook ?? "",
        youtube: brandData.youtube ?? "",
        instagram: brandData.instagram ?? "",
        github: brandData.github ?? "",
      });
    }
  }, [brandData]);

  useEffect(() => {
    if (legalData) {
      setLegalTermsUrl(legalData.legal_terms_url ?? "");
      setLegalPrivacyUrl(legalData.legal_privacy_url ?? "");
    }
  }, [legalData]);

  function addLocale() {
    const code = newCode.trim().toLowerCase();
    const label = newLabel.trim();
    if (!code || !label) return;
    if (!/^[a-z]{2,3}$/.test(code)) {
      toast({ title: "Invalid code", description: "Locale code must be 2-3 lowercase letters", variant: "destructive" });
      return;
    }
    if (locales.some((l) => l.code === code)) {
      toast({ title: "Duplicate", description: `Locale "${code}" already exists`, variant: "destructive" });
      return;
    }
    setLocales((prev) => [...prev, { code, label }]);
    setNewCode("");
    setNewLabel("");
    setDirty(true);
  }

  function removeLocale(code: string) {
    if (locales.length <= 1) return;
    if (code === defaultLocale) {
      toast({ title: "Cannot remove", description: "Set a different default locale first", variant: "destructive" });
      return;
    }
    setLocales((prev) => prev.filter((l) => l.code !== code));
    setDirty(true);
  }

  function setAsDefault(code: string) {
    setDefaultLocale(code);
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/locales", {
        default_locale: defaultLocale,
        supported_locales: locales,
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/locales"] });
      setDirty(false);
      toast({ title: "Settings saved", description: `${locales.length} locale(s) configured` });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleBrandSave(imageUrl: string) {
    setBrandSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/brand-settings", {
        default_social_image: imageUrl,
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brand-settings"] });
      toast({ title: "Brand settings saved", description: "Default social image updated." });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setBrandSaving(false);
    }
  }

  async function handleBrandTitleSave() {
    setTitleSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/brand-settings", {
        title: brandTitle.trim(),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brand-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/variables"] });
      toast({ title: "Brand title saved", description: "Available as {{ brand.title }} in templates." });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setTitleSaving(false);
    }
  }

  async function handleBrandLogoSave(registryId: string | undefined, which: "logo" | "logo_dark") {
    setBrandSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/brand-settings", {
        [which]: registryId ?? "",
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brand-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/variables"] });
      toast({
        title: which === "logo" ? "Light logo saved" : "Dark logo saved",
        description: which === "logo"
          ? "Available as {{ brand.logo }}. Synced to Schema.org organization.logo."
          : "Available as {{ brand.logo_dark }} for dark mode.",
      });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setBrandSaving(false);
    }
  }

  async function handleTwitterSave() {
    setTwitterSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/brand-settings", {
        twitter_handle: twitterHandle.trim(),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brand-settings"] });
      toast({ title: "Twitter / X handle saved" });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setTwitterSaving(false);
    }
  }

  async function handleSocialLinkSave(platform: keyof typeof socialLinks) {
    setSocialSaving(platform);
    try {
      const res = await apiRequest("PUT", "/api/admin/brand-settings", {
        [platform]: socialLinks[platform].trim(),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brand-settings"] });
      toast({ title: `${platform.charAt(0).toUpperCase() + platform.slice(1)} URL saved` });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSocialSaving(null);
    }
  }

  async function runMigration(filename: string) {
    setMigrationStates((prev) => ({
      ...prev,
      [filename]: { running: true, result: null },
    }));
    try {
      const res = await apiRequest("POST", "/api/migrations/run", { filename });
      const result = await res.json();
      setMigrationStates((prev) => ({
        ...prev,
        [filename]: { running: false, result },
      }));
    } catch (err: any) {
      setMigrationStates((prev) => ({
        ...prev,
        [filename]: { running: false, result: { success: false, output: err.message || String(err) } },
      }));
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-4">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Link href="/private/diagnostics">
              <Button variant="ghost" size="icon" data-testid="button-back-settings">
                <IconArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold" data-testid="text-settings-title">Settings</h1>
              <p className="text-sm text-muted-foreground">Site-wide configuration</p>
            </div>
          </div>
          <Link href="/private/tracking">
            <Button variant="outline" size="sm" data-testid="button-go-tracking">
              <IconChartBar className="h-4 w-4 mr-1.5" />
              Tracking
            </Button>
          </Link>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            const next = v as SettingsTab;
            setActiveTab(next);
            const url = new URL(window.location.href);
            if (next === "locales") {
              url.searchParams.delete("tab");
            } else {
              url.searchParams.set("tab", next);
            }
            window.history.replaceState({}, "", url.pathname + url.search);
          }}
        >
          <ToggleButtonBarList className="flex w-full" data-testid="tabs-settings">
            <ToggleButtonBarTrigger value="locales" data-testid="tab-locales" className="gap-1.5">
              <IconLanguage className="h-3.5 w-3.5" />
              Locales
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="migrations" data-testid="tab-migrations" className="gap-1.5">
              <IconCode className="h-3.5 w-3.5" />
              Migrations
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="brand" data-testid="tab-brand" className="gap-1.5">
              <IconPhoto className="h-3.5 w-3.5" />
              Brand
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="robots" data-testid="tab-robots" className="gap-1.5">
              <IconRobot className="h-3.5 w-3.5" />
              Robots
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="legal" data-testid="tab-legal" className="gap-1.5">
              <IconScale className="h-3.5 w-3.5" />
              Legal
            </ToggleButtonBarTrigger>
            <ToggleButtonBarTrigger value="server" data-testid="tab-server" className="gap-1.5">
              <IconServer className="h-3.5 w-3.5" />
              Server
            </ToggleButtonBarTrigger>
          </ToggleButtonBarList>

          <TabsContent value="locales" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
                <div className="flex items-center gap-2">
                  <IconLanguage className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Internationalization</CardTitle>
                </div>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  data-testid="button-save-locales"
                >
                  {saving ? (
                    <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                  )}
                  Save
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Supported Locales</p>
                      <p className="text-xs text-muted-foreground">
                        Locales available for content and URL patterns. The default locale is used as fallback.
                      </p>
                    </div>

                    <div className="space-y-2">
                      {locales.map((locale) => (
                        <div
                          key={locale.code}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-md border"
                          data-testid={`row-locale-${locale.code}`}
                        >
                          <code className="text-sm font-mono font-medium w-8">{locale.code}</code>
                          <span className="text-sm flex-1">{locale.label}</span>
                          {locale.code === defaultLocale ? (
                            <Badge variant="secondary" className="gap-1" data-testid={`badge-default-${locale.code}`}>
                              <IconStar className="fill-current h-3 w-3" />
                              Default
                            </Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setAsDefault(locale.code)}
                              title="Set as default"
                              data-testid={`button-set-default-${locale.code}`}
                            >
                              <IconStar className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLocale(locale.code)}
                            disabled={locales.length <= 1 || locale.code === defaultLocale}
                            title="Remove locale"
                            data-testid={`button-remove-locale-${locale.code}`}
                          >
                            <IconTrash className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-end gap-2 pt-2 border-t">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Code</label>
                        <Input
                          placeholder="pt"
                          value={newCode}
                          onChange={(e) => setNewCode(e.target.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3))}
                          className="w-20"
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocale(); } }}
                          data-testid="input-new-locale-code"
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Label</label>
                        <Input
                          placeholder="Portuguese"
                          value={newLabel}
                          onChange={(e) => setNewLabel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocale(); } }}
                          data-testid="input-new-locale-label"
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={addLocale}
                        disabled={!newCode.trim() || !newLabel.trim()}
                        data-testid="button-add-locale"
                      >
                        <IconPlus className="h-4 w-4 mr-1.5" />
                        Add
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="migrations" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-4">
                <IconCode className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Migrations</CardTitle>
              </CardHeader>
              <CardContent>
                {migrationsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !migrations || migrations.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No migration scripts found.</p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      One-time data scripts. Each migration is idempotent — safe to re-run.
                    </p>
                    <div className="space-y-2">
                      {migrations.map((migration) => {
                        const state = migrationStates[migration.filename];
                        const running = state?.running ?? false;
                        const result = state?.result ?? null;
                        return (
                          <div key={migration.filename} className="space-y-2" data-testid={`row-migration-${migration.filename}`}>
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border">
                              <code className="text-xs font-mono text-muted-foreground flex-1 truncate" data-testid={`text-migration-name-${migration.filename}`}>
                                {migration.filename}
                              </code>
                              {result && (
                                result.success
                                  ? <IconCheck className="h-4 w-4 text-green-500 shrink-0" />
                                  : <IconAlertCircle className="h-4 w-4 text-destructive shrink-0" />
                              )}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="About this migration"
                                    data-testid={`button-info-migration-${migration.filename}`}
                                  >
                                    <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 text-sm" side="left" align="start">
                                  <p className="font-medium mb-1">{migration.name}</p>
                                  <p className="text-muted-foreground text-xs leading-relaxed">{migration.description}</p>
                                </PopoverContent>
                              </Popover>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => runMigration(migration.filename)}
                                disabled={running}
                                title="Run migration"
                                data-testid={`button-run-migration-${migration.filename}`}
                              >
                                {running
                                  ? <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  : <IconPlayerPlay className="h-4 w-4 text-muted-foreground" />
                                }
                              </Button>
                            </div>
                            {result && (
                              <pre
                                className={`text-xs font-mono rounded-md border px-3 py-2 overflow-auto max-h-48 whitespace-pre-wrap ${
                                  result.success
                                    ? "border-green-500/30 bg-green-500/5 text-foreground"
                                    : "border-destructive/30 bg-destructive/5 text-destructive"
                                }`}
                                data-testid={`text-migration-output-${migration.filename}`}
                              >
                                {result.output || (result.success ? "Done." : "Failed with no output.")}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="brand" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-4">
                <IconPhoto className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Brand Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {brandLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground">Template namespaces</p>
                      <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                        <li><code className="font-mono">{"{{ brand.title }}"}</code> / <code className="font-mono">{"{{ brand.logo }}"}</code> / <code className="font-mono">{"{{ brand.logo_dark }}"}</code> — site identity (this tab; stored in <code className="font-mono">variables.yml</code>)</li>
                        <li><code className="font-mono">{"{{ meta.page_title }}"}</code> — this page’s SEO head block (SEO modal → SEO Meta)</li>
                        <li><code className="font-mono">{"{{ single.* }}"}</code> — mapped type fields (DB or Fields-tab overrides on the entry YAML)</li>
                        <li><code className="font-mono">{"{{ global.* }}"}</code> — other site variables</li>
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        Light logo syncs to <code className="font-mono">schema-org.yml</code> <code className="font-mono">organization.logo</code> (crawlers; no dark variant). Navbar uses these when menus reference <code className="font-mono">{"{{ brand.logo }}"}</code>.
                        Choosing a logo from the gallery auto-applies the standard <code className="font-mono">logo</code> and <code className="font-mono">brand</code> tags (same idea as <code className="font-mono">og-image</code> for social images).
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Brand title</p>
                        <p className="text-xs text-muted-foreground">
                          Saved as <code className="font-mono">brand.title</code> in <code className="font-mono">variables.yml</code>; also syncs <code className="font-mono">organization.name</code>.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={brandTitle}
                          onChange={(e) => setBrandTitle(e.target.value)}
                          placeholder="Company name"
                          disabled={titleSaving || !canEditSeo}
                          data-testid="input-brand-title"
                        />
                        <Button
                          size="sm"
                          onClick={handleBrandTitleSave}
                          disabled={titleSaving || !canEditSeo}
                          title={!canEditSeo ? "You don't have permission to edit brand settings" : undefined}
                          data-testid="button-brand-save-title"
                        >
                          {titleSaving ? (
                            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : (
                            <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                          )}
                          Save
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Logo (light)</p>
                          <p className="text-xs text-muted-foreground">
                            Media Gallery registry ID as <code className="font-mono">{"{{ brand.logo }}"}</code>. Used in light mode and Schema.org.
                          </p>
                        </div>
                        <div
                          className="rounded-md border bg-muted flex items-center justify-center overflow-hidden p-4 min-h-[80px]"
                          data-testid="img-brand-logo-preview-container"
                        >
                          {brandData?.logo_src ? (
                            <img
                              src={brandData.logo_src}
                              alt="Brand logo light"
                              className="object-contain max-h-16 w-auto"
                              data-testid="img-brand-logo-preview"
                            />
                          ) : (
                            <div className="text-center space-y-1 text-muted-foreground">
                              <IconPhoto className="h-6 w-6 mx-auto opacity-40" />
                              <p className="text-xs">No logo</p>
                            </div>
                          )}
                        </div>
                        {brandData?.logo && (
                          <p className="text-xs text-muted-foreground font-mono truncate" data-testid="text-brand-logo-id">
                            {brandData.logo}
                          </p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLogoPickerOpen(true)}
                          disabled={brandSaving || !canEditSeo}
                          data-testid="button-brand-choose-logo"
                        >
                          {brandSaving ? (
                            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : (
                            <IconPhoto className="h-4 w-4 mr-1.5" />
                          )}
                          Choose from gallery
                        </Button>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Logo (dark)</p>
                          <p className="text-xs text-muted-foreground">
                            Optional. <code className="font-mono">{"{{ brand.logo_dark }}"}</code> — shown when the site is in dark mode. If unset, the light logo is used in both themes.
                          </p>
                        </div>
                        <div
                          className="rounded-md border bg-zinc-900 flex items-center justify-center overflow-hidden p-4 min-h-[80px]"
                          data-testid="img-brand-logo-dark-preview-container"
                        >
                          {brandData?.logo_dark_src || brandData?.logo_src ? (
                            <img
                              src={brandData.logo_dark_src || brandData.logo_src}
                              alt="Brand logo dark"
                              className="object-contain max-h-16 w-auto"
                              data-testid="img-brand-logo-dark-preview"
                            />
                          ) : (
                            <div className="text-center space-y-1 text-muted-foreground">
                              <IconPhoto className="h-6 w-6 mx-auto opacity-40" />
                              <p className="text-xs">No dark logo</p>
                            </div>
                          )}
                        </div>
                        {brandData?.logo_dark && (
                          <p className="text-xs text-muted-foreground font-mono truncate" data-testid="text-brand-logo-dark-id">
                            {brandData.logo_dark}
                          </p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLogoDarkPickerOpen(true)}
                          disabled={brandSaving || !canEditSeo}
                          data-testid="button-brand-choose-logo-dark"
                        >
                          {brandSaving ? (
                            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : (
                            <IconPhoto className="h-4 w-4 mr-1.5" />
                          )}
                          Choose from gallery
                        </Button>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-1">
                      <p className="text-sm font-medium">Default Social Image</p>
                      <p className="text-xs text-muted-foreground">
                        Used as the fallback <code className="font-mono">og:image</code> on pages that don't have a specific social image. Recommended size: 1200×630 px.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Saved to <code className="font-mono">schema-org.yml</code> under <code className="font-mono">website.default_social_image</code>.
                      </p>
                    </div>

                    <div className="space-y-3">
                      {brandData?.default_social_image ? (
                        <div
                          className="rounded-md border bg-muted overflow-hidden"
                          style={{ aspectRatio: "1200/630", maxHeight: "160px" }}
                          data-testid="img-brand-social-preview-container"
                        >
                          <img
                            src={brandData.default_social_image}
                            alt="Default social image preview"
                            className="object-cover w-full h-full"
                            data-testid="img-brand-social-preview"
                          />
                        </div>
                      ) : (
                        <div
                          className="rounded-md border bg-muted flex items-center justify-center text-muted-foreground"
                          style={{ aspectRatio: "1200/630", maxHeight: "160px" }}
                          data-testid="div-brand-social-placeholder"
                        >
                          <div className="text-center space-y-1">
                            <IconPhoto className="h-8 w-8 mx-auto opacity-40" />
                            <p className="text-xs">No image selected</p>
                          </div>
                        </div>
                      )}

                      {brandData?.default_social_image && (
                        <p className="text-xs text-muted-foreground font-mono truncate" data-testid="text-brand-social-url">
                          {brandData.default_social_image}
                        </p>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setBrandImagePickerOpen(true)}
                        disabled={brandSaving || !canEditSeo}
                        title={!canEditSeo ? "You don't have permission to edit brand settings" : undefined}
                        data-testid="button-brand-choose-image"
                      >
                        {brandSaving ? (
                          <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <IconPhoto className="h-4 w-4 mr-1.5" />
                        )}
                        Choose from gallery
                      </Button>
                    </div>

                    <div className="pt-2 border-t space-y-2">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Twitter / X Handle</p>
                        <p className="text-xs text-muted-foreground">
                          Saved to <code className="font-mono">4geeks-com/schema-org.yml</code> under <code className="font-mono">organization.same_as</code>.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={twitterHandle}
                          onChange={(e) => setTwitterHandle(e.target.value)}
                          placeholder="@handle"
                          disabled={twitterSaving || !canEditSeo}
                          data-testid="input-brand-twitter-handle"
                          className="font-mono"
                        />
                        <Button
                          size="sm"
                          onClick={handleTwitterSave}
                          disabled={twitterSaving || !canEditSeo}
                          title={!canEditSeo ? "You don't have permission to edit brand settings" : undefined}
                          data-testid="button-brand-save-twitter"
                        >
                          {twitterSaving ? (
                            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : (
                            <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                          )}
                          Save
                        </Button>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Social Links</p>
                        <p className="text-xs text-muted-foreground">
                          Stored in <code className="font-mono">organization.same_as</code> in <code className="font-mono">schema-org.yml</code>.
                        </p>
                      </div>
                      {(
                        [
                          { key: "linkedin", label: "LinkedIn", placeholder: "https://www.linkedin.com/school/yourorg/" },
                          { key: "facebook", label: "Facebook", placeholder: "https://www.facebook.com/yourorg" },
                          { key: "youtube", label: "YouTube", placeholder: "https://www.youtube.com/c/YourOrg" },
                          { key: "instagram", label: "Instagram", placeholder: "https://www.instagram.com/yourorg/" },
                          { key: "github", label: "GitHub", placeholder: "https://github.com/YourOrg" },
                        ] as { key: keyof typeof socialLinks; label: string; placeholder: string }[]
                      ).map(({ key, label, placeholder }) => {
                        const fieldError = socialErrors[key] ?? null;
                        return (
                          <div key={key} className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">{label}</label>
                            <div className="flex items-center gap-2">
                              <Input
                                value={socialLinks[key]}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSocialLinks((prev) => ({ ...prev, [key]: val }));
                                  setSocialErrors((prev) => ({ ...prev, [key]: validateSocialUrl(key, val) }));
                                }}
                                placeholder={placeholder}
                                disabled={socialSaving === key || !canEditSeo}
                                data-testid={`input-brand-${key}`}
                                className={`font-mono text-xs${fieldError ? " border-destructive focus-visible:ring-destructive" : ""}`}
                              />
                              <Button
                                size="sm"
                                onClick={() => handleSocialLinkSave(key)}
                                disabled={socialSaving === key || !canEditSeo || !!fieldError}
                                title={
                                  !canEditSeo
                                    ? "You don't have permission to edit brand settings"
                                    : fieldError
                                    ? fieldError
                                    : undefined
                                }
                                data-testid={`button-brand-save-${key}`}
                              >
                                {socialSaving === key ? (
                                  <IconLoader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <IconDeviceFloppy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            {fieldError && (
                              <p className="text-xs text-destructive" data-testid={`error-brand-${key}`}>
                                {fieldError}
                              </p>
                            )}
                          </div>
                        );
                      })}

                      {brandData?.unknown_same_as && brandData.unknown_same_as.length > 0 && (
                        <div className="pt-2 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Other links (read-only)</p>
                          <p className="text-xs text-muted-foreground">These URLs are in <code className="font-mono">same_as</code> but don't match a known platform. Edit them directly in the YAML file.</p>
                          <div className="space-y-1">
                            {brandData.unknown_same_as.map((url) => (
                              <p key={url} className="text-xs font-mono text-muted-foreground bg-muted rounded px-2 py-1 truncate" data-testid="text-brand-unknown-sameas">
                                {url}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <ImagePickerDialog
              open={brandImagePickerOpen}
              onOpenChange={setBrandImagePickerOpen}
              title="Select Default Social Image"
              defaultTagFilter="og-image"
              ensureTagsOnSave={[...OG_IMAGE_ENSURE_TAGS]}
              initialSrc={brandData?.default_social_image ?? ""}
              initialAlt="Default social image"
              onSave={async (src) => {
                await handleBrandSave(src);
              }}
            />
            <ImagePickerDialog
              open={logoPickerOpen}
              onOpenChange={setLogoPickerOpen}
              title="Select Brand Logo (light)"
              tagFilter="logo"
              ensureTagsOnSave={[...BRAND_LOGO_ENSURE_TAGS]}
              initialSrc={brandData?.logo_src ?? ""}
              initialAlt="Brand logo"
              onSave={async (_src, _alt, registryId) => {
                await handleBrandLogoSave(registryId, "logo");
              }}
            />
            <ImagePickerDialog
              open={logoDarkPickerOpen}
              onOpenChange={setLogoDarkPickerOpen}
              title="Select Brand Logo (dark)"
              tagFilter="logo"
              ensureTagsOnSave={[...BRAND_LOGO_ENSURE_TAGS]}
              initialSrc={brandData?.logo_dark_src || brandData?.logo_src || ""}
              initialAlt="Brand logo dark"
              onSave={async (_src, _alt, registryId) => {
                await handleBrandLogoSave(registryId, "logo_dark");
              }}
            />
          </TabsContent>

          <TabsContent value="robots" className="mt-4">
            <RobotsTab />
          </TabsContent>

          <TabsContent value="legal" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-4">
                <IconScale className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Legal URLs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {legalLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">
                        These URLs are stored as <code className="font-mono">reserved.legal_terms_url</code> and <code className="font-mono">reserved.legal_privacy_url</code> in <code className="font-mono">variables.yml</code> and are automatically available as <code className="font-mono">global.*</code> variables site-wide.
                      </p>
                    </div>

                    <div className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="input-legal-terms-url">
                          Terms &amp; Conditions URL
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Used in lead forms and consent copy. Accepts a full URL or a relative path (e.g. <code className="font-mono">/en/terms-conditions</code>).
                        </p>
                        <div className="flex items-center gap-2">
                          <LinkPicker
                            value={legalTermsUrl}
                            onChange={(v) => { setLegalTermsUrl(v); handleLegalSave("legal_terms_url", v); }}
                            testId="link-picker-legal-terms-url"
                            allowedTypes={["internal", "external"]}
                          />
                          {legalSaving === "legal_terms_url" && (
                            <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="input-legal-privacy-url">
                          Privacy Policy URL
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Used in lead forms and consent copy. Accepts a full URL or a relative path (e.g. <code className="font-mono">/en/privacy-policy</code>).
                        </p>
                        <div className="flex items-center gap-2">
                          <LinkPicker
                            value={legalPrivacyUrl}
                            onChange={(v) => { setLegalPrivacyUrl(v); handleLegalSave("legal_privacy_url", v); }}
                            testId="link-picker-legal-privacy-url"
                            allowedTypes={["internal", "external"]}
                          />
                          {legalSaving === "legal_privacy_url" && (
                            <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader className="flex flex-row items-center gap-2 pb-4">
                <IconMessage className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <CardTitle className="text-base">Consent Messages</CardTitle>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openAddConsent}
                  data-testid="button-add-consent"
                >
                  <IconPlus className="h-4 w-4 mr-1" />
                  Add consent
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Site-wide checkbox copy for lead forms, stored as <code className="font-mono">reserved.consent_*</code> variables.
                  Turn on <span className="font-medium text-foreground">Default</span> in a consent&apos;s Edit dialog — that copy is the extra checkbox when a form has no channel (Marketing, SMS, WhatsApp, …) on.
                  Only one can be Default; others stay off until you turn the current one off.
                  Stored in <code className="font-mono">settings.yml</code> as <code className="font-mono">consent.fallback</code>. Off means no extra checkbox.
                  <span className="font-medium text-foreground"> Marketing</span> is the copy for the Marketing switch.
                  The default locale is <code className="font-mono">default</code>; other locales are <code className="font-mono">conditions</code> with <code className="font-mono">query.locale</code>.
                  Empty builtins show the form&apos;s built-in copy so you can edit from it. Links and formatting use the rich-text editor.
                </p>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Read more (advanced)</summary>
                  <p className="mt-1 leading-snug">
                    Default writes <code className="font-mono">consent.fallback</code> in{" "}
                    <code className="font-mono">site_*/settings.yml</code> via{" "}
                    <code className="font-mono">PUT /api/settings/consent/fallback</code>
                    {" "}(<code className="font-mono">server/settings.ts</code>).
                    The form reads it in{" "}
                    <code className="font-mono">client/src/components/lead_form/variants/LeadFormDefault.tsx</code>
                    {" "}(<code className="font-mono">shouldShowFallbackConsent</code>).
                    Default is not a YAML channel toggle — ConsentCard still uses{" "}
                    <code className="font-mono">consent.marketing</code> / SMS / WhatsApp.
                    General fallback does not set CRM <code className="font-mono">has_marketing_consent</code>.
                  </p>
                </details>
                <div className="divide-y">
                  {consentKeys.map((key) => {
                    const stored = consentData?.[key] ?? {};
                    const seen = new Set<string>();
                    const localePreviews: { code: string; text: string; builtin: boolean }[] = [];
                    for (const loc of supportedLocalesForConsent) {
                      const storedText = stored[loc.code];
                      const builtin = isBlankConsentHtml(storedText);
                      const raw = builtin ? getBuiltinConsentFallback(key, loc.code) : storedText;
                      const text = stripConsentHtml(raw ?? "");
                      if (!text) continue;
                      seen.add(loc.code);
                      localePreviews.push({ code: loc.code, text, builtin });
                    }
                    for (const [code, raw] of Object.entries(stored)) {
                      if (seen.has(code) || isBlankConsentHtml(raw)) continue;
                      localePreviews.push({ code, text: stripConsentHtml(raw), builtin: false });
                    }
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-3 py-3"
                        data-testid={`row-consent-${key}`}
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{consentLabelFromKey(key)}</span>
                            <Badge variant="secondary" className="font-mono text-xs">
                              reserved.{key}
                            </Badge>
                            {consentFallback === key ? (
                              <Badge data-testid={`badge-consent-fallback-${key}`}>
                                Default
                              </Badge>
                            ) : null}
                          </div>
                          {localePreviews.length > 0 ? (
                            <div className="space-y-1">
                              {localePreviews.map(({ code, text, builtin }) => (
                                <div key={code} className="flex items-center gap-2 min-w-0">
                                  <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 shrink-0">
                                    {code}
                                  </Badge>
                                  {builtin ? (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 font-normal">
                                      built-in
                                    </Badge>
                                  ) : null}
                                  <p className={`text-xs truncate ${builtin ? "text-muted-foreground/70 italic" : "text-muted-foreground"}`}>
                                    {text}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground/60 italic">
                              No default set
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditConsent(key)}
                          data-testid={`button-edit-consent-${key}`}
                        >
                          Edit
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Dialog
              modal={false}
              open={editingConsent !== null}
              onOpenChange={(open) => {
                if (!open && ignoreConsentDialogCloseRef.current) return;
                if (!open) setEditingConsent(null);
              }}
            >
              <DialogContent
                forceOverlay
                className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
                onPointerDownOutside={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("[data-radix-popper-content-wrapper]")) {
                    e.preventDefault();
                    markConsentPopoverInteract();
                  }
                }}
                onFocusOutside={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("[data-radix-popper-content-wrapper]")) {
                    e.preventDefault();
                    markConsentPopoverInteract();
                  }
                }}
                onInteractOutside={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("[data-radix-popper-content-wrapper]")) {
                    e.preventDefault();
                    markConsentPopoverInteract();
                  }
                }}
              >
                <DialogHeader>
                  <DialogTitle>
                    {editingConsent?.mode === "add" ? "Add consent message" : `${consentLabelFromKey(editingConsent?.key ?? "")} consent message`}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  {editingConsent?.mode === "add" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="consent-name">Name</Label>
                      <Input
                        id="consent-name"
                        value={editingConsent.nameInput}
                        onChange={(e) => setEditingConsent((prev) => prev ? { ...prev, nameInput: e.target.value } : null)}
                        placeholder="WhatsApp"
                        data-testid="input-consent-name"
                      />
                      <p className="text-xs text-muted-foreground">
                        Key: <code className="font-mono">{editingConsentKey || "consent_…"}</code>
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      <code className="font-mono">reserved.{editingConsent?.key}</code>
                      {isBuiltinConsentKey(editingConsent?.key ?? "") ? " — empty locales start from the form's built-in copy." : null}
                    </p>
                  )}
                  {editingConsent?.mode === "edit" && editingConsentKey ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="consent-fallback-modal"
                          checked={consentFallback === editingConsentKey}
                          disabled={
                            fallbackSaving
                            || (!!consentFallback && consentFallback !== editingConsentKey)
                          }
                          onCheckedChange={(on) => handleConsentFallbackToggle(editingConsentKey, on)}
                          data-testid="switch-consent-fallback"
                        />
                        <Label
                          htmlFor="consent-fallback-modal"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Default
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {consentFallback && consentFallback !== editingConsentKey
                          ? `Already set to ${consentLabelFromKey(consentFallback)}. Turn that one off first.`
                          : "When a form has no channel checkboxes on, show this copy. Off means no extra checkbox."}
                      </p>
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Message per locale
                    </p>
                    {supportedLocalesForConsent.map((loc) => (
                      <div key={loc.code} className="space-y-1.5">
                        <Label htmlFor={`consent-msg-${loc.code}`} className="text-xs">
                          {loc.label}{" "}
                          <span className="font-mono text-muted-foreground">({loc.code})</span>
                          {loc.code === defaultLocaleForConsent ? (
                            <span className="text-muted-foreground font-normal"> — default</span>
                          ) : null}
                        </Label>
                        <RichTextArea
                          value={editingConsent?.locales[loc.code] ?? ""}
                          onChange={(html) => setEditingConsent((prev) => prev ? {
                            ...prev,
                            locales: { ...prev.locales, [loc.code]: html },
                          } : null)}
                          placeholder={`Consent copy in ${loc.label}…`}
                          minHeight="88px"
                          locale={loc.code}
                          data-testid={`input-consent-message-${loc.code}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditingConsent(null)}>Cancel</Button>
                  <Button
                    onClick={handleConsentSave}
                    disabled={consentSaving || (editingConsent?.mode === "add" && !editingConsentKey)}
                    data-testid="button-save-consent"
                  >
                    {consentSaving ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="server" className="mt-4">
            <ServerTab />
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
