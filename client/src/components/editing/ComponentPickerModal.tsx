import { useState, useEffect, useRef, useMemo } from "react";
import { AlertTriangle, ArrowRight, Award, BarChart2, Blocks, Book, Brain, Building2, Check, ClipboardList, Columns, Columns2, CreditCard, FolderCode, HelpCircle, Image, Info, List, ListFilter, MessageSquare, MousePointerClick, PanelBottom, RefreshCw, Rocket, ScatterChart, Search, Sparkles, Star, Table, Trophy, Users, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import jsYaml from "js-yaml";
import type { ComponentPairing } from "@shared/schema";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { useContentTypesRaw } from "@/hooks/useContentTypes";
import { emitContentUpdated } from "@/lib/contentEvents";
import {
  listArticlesOnPage,
  resolveTocGroupId,
  buildSiblingTocGroupOps,
} from "@/lib/articleTocShare";
import { schemaOrgInsertIndex } from "@shared/schema-org-sections";
import { DbTemplateWarningDialog } from "@/components/editing/DbTemplateWarningDialog";
import { RelatedFeaturesPicker } from "./RelatedFeaturesPicker";
import { TableBuilderWizard, type DynamicTableConfig } from "@/components/TableBuilderWizard";

interface ComponentPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  insertIndex: number;
  /** Current page sections (used for article toc_group prompting). */
  sections?: Array<Record<string, unknown>>;
  contentType?: string;
  slug?: string;
  locale?: string;
  variant?: string;
  version?: number;
  isSharedTemplate?: boolean;
  singleEntry?: Record<string, unknown>;
  /** When false, entry-scoped adds are disabled (attached shared-layout). */
  allowEntryStructuralOverrides?: boolean;
  /** Pre-selected scope from the upfront scope dialog in AddSectionButton.
   *  "entry" → per-entry add; "template" → shared template add. */
  addScope?: "entry" | "template";
}

interface ComponentInfo {
  type: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

interface ApiExample {
  name: string;
  description: string;
  yaml: string;
  variant?: string;
}

interface ProcessedExample {
  name: string;
  slug: string;
  variant: string;
  content: Record<string, unknown>;
}

interface RegistryComponent {
  type: string;
  name: string;
  description: string;
  latestVersion: string;
  versions: string[];
}

interface RegistryOverview {
  components: RegistryComponent[];
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  hero: Rocket,
  two_column: Columns2,
  two_column_accordion_card: Columns,
  comparison_table: Table,
  features_grid: Columns2,
  numbered_steps: ArrowRight,
  ai_learning: Brain,
  mentorship: Users,
  pricing: CreditCard,
  projects: FolderCode,
  project_showcase: BarChart2,
  syllabus: Book,
  why_learn_ai: Sparkles,
  certificate: Award,
  whos_hiring: Building2,
  testimonials: MessageSquare,
  testimonials_slide: MessageSquare,
  faq: HelpCircle,
  cta_banner: MousePointerClick,
  footer: PanelBottom,
  award_badges: Award,
  awards_marquee: Trophy,
  bullet_tabs_showcase: ListFilter,
  apply_form: ClipboardList,
  lead_form: ClipboardList,
  graduates_stats: ScatterChart,
  horizontal_bars: BarChart2,
  vertical_bars_cards: BarChart2,
  human_and_ai_duo: Users,
  community_support: Users,
  article: Book,
  dynamic_table: Table,
  modal: MousePointerClick,
  cards_deck: Columns2,
  trust_cards: Star,
};

const variantLabels: Record<string, string> = {
  singleColumn: "Single Column",
  blogHero: "Blog Hero",
  showcase: "Showcase",
  productShowcase: "Product Showcase",
  simpleTwoColumn: "Two Column",
  imageText: "Image + Text",
  bulletGroups: "Bullet Groups",
  video: "Video",
  highlight: "Highlight",
  detailed: "Detailed",
  default: "Default",
  subscription: "Subscription",
  product: "Product",
};

const CONTENT_TYPE_INTENT: Record<string, string> = {
  landing: "lead_generation",
  program: "product_service",
  blog: "content_seo",
  page: "brand_corporate",
  location: "brand_corporate",
  downloadable: "lead_generation",
  "outcome-report": "outcome",
};

const INTENT_LABELS: Record<string, string> = {
  lead_generation: "lead generation",
  product_service: "product / service",
  content_seo: "content / SEO",
  brand_corporate: "brand / corporate",
  outcome: "outcomes",
};

interface SuggestionItem {
  type: string;
  score: number;
  frequency: number;
  count: number;
  fromHeuristics?: boolean;
}

const POSITION_TOP_COMPONENTS = ["hero", "hero_credibility", "trust_cards", "award_badges", "awards_marquee"];
const POSITION_MID_COMPONENTS = ["features_grid", "two_column", "testimonials", "pricing", "why_learn_ai", "mentorship", "syllabus", "numbered_steps", "ai_learning", "bullet_tabs_showcase"];
const POSITION_BOTTOM_COMPONENTS = ["cta_banner", "faq", "testimonials_slide", "whos_hiring", "graduates_stats", "certificate", "lead_form"];

function buildPositionHeuristics(
  insertIndex: number,
  totalSections: number,
  availableTypes: Set<string>,
): SuggestionItem[] {
  const relativePos = totalSections === 0 ? 0 : insertIndex / Math.max(totalSections, 1);
  let order: string[];
  if (relativePos <= 0.25) {
    order = [...POSITION_TOP_COMPONENTS, ...POSITION_MID_COMPONENTS, ...POSITION_BOTTOM_COMPONENTS];
  } else if (relativePos >= 0.75) {
    order = [...POSITION_BOTTOM_COMPONENTS, ...POSITION_MID_COMPONENTS, ...POSITION_TOP_COMPONENTS];
  } else {
    order = [...POSITION_MID_COMPONENTS, ...POSITION_BOTTOM_COMPONENTS, ...POSITION_TOP_COMPONENTS];
  }
  return order
    .filter((t) => availableTypes.has(t))
    .slice(0, 8)
    .map((type, idx) => ({
      type,
      score: 1 - idx * 0.1,
      frequency: 0,
      count: 0,
      fromHeuristics: true,
    }));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function parseYamlContent(yamlStr: string): Record<string, unknown> | null {
  try {
    const { escaped, map } = escapeTemplateVars(yamlStr);
    const parsed = unescapeObjectVars(jsYaml.load(escaped), map);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const section = parsed[0];
      const { type, ...rest } = section as Record<string, unknown>;
      return rest;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const { type, ...rest } = parsed as Record<string, unknown>;
      return rest;
    }
    return null;
  } catch {
    return null;
  }
}

export default function ComponentPickerModal({
  isOpen,
  onClose,
  insertIndex,
  sections: sectionsProp = [],
  contentType,
  slug,
  locale,
  variant,
  version,
  isSharedTemplate,
  singleEntry,
  allowEntryStructuralOverrides = true,
  addScope,
}: ComponentPickerModalProps) {
  const effectiveAddScope =
    addScope === "entry" && !allowEntryStructuralOverrides ? "template" : addScope;
  const [step, setStep] = useState<"select" | "configure" | "wizard">("select");
  const [selectedComponent, setSelectedComponent] = useState<ComponentInfo | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [examples, setExamples] = useState<ProcessedExample[]>([]);
  const [selectedExample, setSelectedExample] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedRelatedFeatures, setSelectedRelatedFeatures] = useState<string[]>([]);
  const [componentSearch, setComponentSearch] = useState("");
  const [activePickerTab, setActivePickerTab] = useState<"suggested" | "all">("suggested");
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [isStartSuggestion, setIsStartSuggestion] = useState(false);
  const [addWarnOpen, setAddWarnOpen] = useState(false);
  /** Used by the DbTemplateWarningDialog confirm callback (template-only path, no singleEntry). */
  const pendingAddFn = useRef<(() => Promise<void>) | null>(null);
  const { toast } = useToast();
  const { data: rawContentTypes } = useContentTypesRaw();

  const pageSections = useMemo(() => {
    if (sectionsProp.length > 0) return sectionsProp;
    const fromEntry = singleEntry?.sections;
    return Array.isArray(fromEntry) ? (fromEntry as Array<Record<string, unknown>>) : [];
  }, [sectionsProp, singleEntry]);

  const existingArticles = useMemo(() => listArticlesOnPage(pageSections), [pageSections]);

  const resolveInsertIndex = (componentType: string | undefined) =>
    componentType === "schema_org" ? schemaOrgInsertIndex(pageSections) : insertIndex;

  const scrollAfterSchemaOrgAdd = (componentType: string | undefined) => {
    if (componentType !== "schema_org") return;
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const singularLabel = (() => {
    if (!contentType) return "entry";
    const found = rawContentTypes?.find((t) => t.name === contentType);
    const label = found?.label ?? contentType.replace(/_/g, " ");
    const lower = label.toLowerCase();
    if (lower.endsWith("ies")) return lower.slice(0, -3) + "y";
    if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("zes")) return lower.slice(0, -2);
    if (lower.endsWith("s") && lower.length > 2) return lower.slice(0, -1);
    return lower;
  })();

  const { data: registryData, isLoading: isLoadingRegistry } = useQuery<RegistryOverview>({
    queryKey: ["/api/component-registry"],
    enabled: isOpen,
  });

  const componentsList: ComponentInfo[] = useMemo(() => {
    if (!registryData?.components) return [];
    
    const RESERVED_COMPONENT_NAMES = ["common", "_common", "shared", "_shared", "utils", "_utils"];
    
    return registryData.components
      .filter((comp) => !RESERVED_COMPONENT_NAMES.includes(comp.type.toLowerCase()))
      .map((comp) => ({
        type: comp.type,
        label: comp.name,
        icon: iconMap[comp.type] || Blocks,
        description: comp.description || "",
      }));
  }, [registryData]);

  const filteredComponentsList = (() => {
    if (!componentSearch.trim()) return componentsList;
    const searchLower = componentSearch.toLowerCase();
    return componentsList.filter(
      (comp) =>
        comp.label.toLowerCase().includes(searchLower) ||
        comp.type.toLowerCase().includes(searchLower) ||
        comp.description.toLowerCase().includes(searchLower)
    );
  })();

  const alreadyUsedTypes = (() => {
    return new Set(pageSections.map((s) => s.type as string).filter(Boolean));
  })();

  const suggestedComponents = suggestions
    .map((s) => componentsList.find((c) => c.type === s.type))
    .filter((c): c is ComponentInfo => !!c)
    .map((c) => {
      const s = suggestions.find((sg) => sg.type === c.type)!;
      return { ...c, suggestion: s };
    });

  const prevSectionLabel = (() => {
    const prevSection = insertIndex > 0 ? pageSections[insertIndex - 1] : null;
    if (!prevSection) return null;
    const comp = componentsList.find((c) => c.type === prevSection.type);
    return comp?.label ?? (prevSection.type as string);
  })();

  const intentLabel = (() => {
    if (!contentType) return null;
    const intent = CONTENT_TYPE_INTENT[contentType] ?? "brand_corporate";
    return INTENT_LABELS[intent] ?? intent;
  })();

  useEffect(() => {
    if (selectedComponent) {
      setIsLoading(true);
      fetch(`/api/component-registry/${selectedComponent.type}/versions`)
        .then(res => res.json())
        .then(data => {
          const vers = data.versions || [];
          setVersions(vers);
          if (vers.length > 0) {
            setSelectedVersion(vers[vers.length - 1]);
          }
        })
        .catch(() => setVersions([]))
        .finally(() => setIsLoading(false));
    }
  }, [selectedComponent]);

  useEffect(() => {
    if (selectedComponent && selectedVersion) {
      setIsLoading(true);
      fetch(`/api/component-registry/${selectedComponent.type}/${selectedVersion}/examples`)
        .then(res => res.json())
        .then(data => {
          const apiExamples: ApiExample[] = data.examples || [];
          const processed: ProcessedExample[] = apiExamples.map((ex, idx) => {
            const content = parseYamlContent(ex.yaml);
            return {
              name: ex.name,
              slug: slugify(ex.name) || `example-${idx}`,
              variant: ex.variant || 'default',
              content: content || {},
            };
          }).filter(ex => Object.keys(ex.content).length > 0);
          
          setExamples(processed);
          if (processed.length > 0) {
            setSelectedExample(processed[0].slug);
          }
        })
        .catch(() => setExamples([]))
        .finally(() => setIsLoading(false));
    }
  }, [selectedComponent, selectedVersion]);

  const selectedExampleData = examples.find(e => e.slug === selectedExample) || null;

  useEffect(() => {
    if (!isOpen) {
      setComponentSearch("");
      setStep("select");
      setSelectedComponent(null);
      setActivePickerTab("suggested");
      setSuggestions([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || step !== "select") return;

    const intent = contentType ? (CONTENT_TYPE_INTENT[contentType] ?? "brand_corporate") : undefined;
    const prevSection = insertIndex > 0 ? pageSections[insertIndex - 1] : null;
    const isStart = !prevSection?.type;
    setIsStartSuggestion(isStart);
    setSuggestionsLoading(true);

    const params = new URLSearchParams();
    if (intent) params.set("intent", intent);
    params.set("rankBy", "pmi");
    if (prevSection?.type) params.set("after", String(prevSection.type));

    const applyHeuristics = () => {
      if (componentsList.length === 0) {
        setSuggestions([]);
        return;
      }
      const availableTypes = new Set(componentsList.map((c) => c.type));
      setSuggestions(buildPositionHeuristics(insertIndex, pageSections.length, availableTypes));
    };

    fetch(`/api/private/component-insights/suggest?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ComponentPairing[]) => {
        if (!Array.isArray(data) || data.length === 0) {
          applyHeuristics();
          return;
        }
        const alreadyUsed = new Set(pageSections.map((s) => s.type as string));
        const maxPmi = data.reduce((m, p) => Math.max(m, p.pmi), 0);
        const norm = maxPmi > 0 ? maxPmi : 1;
        const ALREADY_USED_PENALTY = 0.3;
        const scored: SuggestionItem[] = data
          .map((p) => ({
            type: p.to,
            score: (isStart ? p.frequency : p.pmi / norm) - (alreadyUsed.has(p.to) ? ALREADY_USED_PENALTY : 0),
            frequency: p.frequency,
            count: p.count,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        setSuggestions(scored);
      })
      .catch(() => applyHeuristics())
      .finally(() => setSuggestionsLoading(false));
  }, [isOpen, step, contentType, insertIndex, pageSections, componentsList]);

  // When registry loads after suggestions already resolved empty, re-apply heuristics
  useEffect(() => {
    if (!isOpen || step !== "select" || suggestionsLoading) return;
    if (suggestions.length > 0) return;
    if (componentsList.length === 0) return;
    const availableTypes = new Set(componentsList.map((c) => c.type));
    const heuristics = buildPositionHeuristics(insertIndex, pageSections.length, availableTypes);
    if (heuristics.length > 0) setSuggestions(heuristics);
  }, [componentsList, isOpen, step, suggestionsLoading, suggestions.length, insertIndex, pageSections]);

  // Auto-switch to All tab when loading is done and there are still no suggestions
  useEffect(() => {
    if (suggestionsLoading || isLoadingRegistry) return;
    if (!isOpen || step !== "select") return;
    if (suggestions.length === 0 && componentsList.length > 0) {
      setActivePickerTab("all");
    }
  }, [suggestionsLoading, isLoadingRegistry, isOpen, step, suggestions.length, componentsList.length]);

  const handleSelectComponent = (component: ComponentInfo) => {
    setSelectedComponent(component);
    if (component.type === "dynamic_table") {
      setStep("wizard");
    } else {
      setStep("configure");
    }
    setVersions([]);
    setExamples([]);
    setSelectedVersion("");
    setSelectedExample("");
    setSelectedRelatedFeatures([]);
  };

  const handleBack = () => {
    setStep("select");
    setSelectedComponent(null);
    setVersions([]);
    setExamples([]);
    setSelectedVersion("");
    setSelectedExample("");
    setSelectedRelatedFeatures([]);
    setComponentSearch("");
  };

  const executeWizardComplete = async (config: DynamicTableConfig) => {
    if (!contentType || !slug || !locale) return;

    setIsAdding(true);
    try {
      const sectionToAdd = {
        type: "dynamic_table",
        version: "1.0",
        endpoint: config.endpoint,
        ...(config.data_path ? { data_path: config.data_path } : {}),
        ...(config.title ? { title: config.title } : {}),
        columns: config.columns,
        ...(config.action ? { action: config.action } : {}),
      };

      const token = getDebugToken();
      const author = await resolveAuthorName();
      const response = await fetch("/api/content/edit-sections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Token ${token}` } : {}),
        },
        body: JSON.stringify({
          contentType,
          slug,
          locale,
          variant,
          version,
          author,
          operations: [{
            action: "add_item",
            path: "sections",
            item: sectionToAdd,
            index: insertIndex,
          }],
        }),
      });

      if (response.ok) {
        onClose();
        emitContentUpdated({ contentType: contentType!, slug: slug!, locale: locale! });
        toast({
          title: "Dynamic table added",
          description: config.title || "Table section inserted successfully",
        });
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error("Failed to add dynamic table:", errorData);
        toast({
          title: "Failed to add table",
          description: errorData.error || "Unknown error occurred",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error adding dynamic table:", error);
      toast({
        title: "Error",
        description: "Failed to add the table section",
        variant: "destructive",
      });
    } finally {
      setIsAdding(false);
    }
  };

  /** Per-entry variant of wizard add — sends the wizard section to /api/per-entry-section-add */
  const executePerEntryWizardComplete = async (config: DynamicTableConfig) => {
    if (!contentType || !slug || !locale) return;
    setIsAdding(true);
    try {
      const sectionData = {
        type: "dynamic_table",
        version: "1.0",
        endpoint: config.endpoint,
        ...(config.data_path ? { data_path: config.data_path } : {}),
        ...(config.title ? { title: config.title } : {}),
        columns: config.columns,
        ...(config.action ? { action: config.action } : {}),
      };
      const token = getDebugToken();
      const resp = await fetch("/api/per-entry-section-add", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify({ contentType, slug, locale, sectionData, insertIndex }),
      });
      if (resp.ok) {
        onClose();
        emitContentUpdated({ contentType, slug, locale });
        toast({ title: "Table added", description: "Dynamic table added to this entry only." });
      } else {
        const err = await resp.json().catch(() => ({}));
        toast({ title: "Failed to add table", description: err.error || "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error adding table", variant: "destructive" });
    } finally {
      setIsAdding(false);
    }
  };

  const handleWizardComplete = async (config: DynamicTableConfig) => {
    if (effectiveAddScope === "entry") {
      await executePerEntryWizardComplete(config);
      return;
    }
    if (effectiveAddScope === "template") {
      await executeWizardComplete(config);
      return;
    }
    if (isSharedTemplate && !variant) {
      pendingAddFn.current = () => executeWizardComplete(config);
      setAddWarnOpen(true);
      return;
    }
    await executeWizardComplete(config);
  };

  const executeAddSection = async (opts?: { shareToc?: boolean }) => {
    if (!selectedExampleData || !selectedComponent || !contentType || !slug || !locale) {
      return;
    }

    setIsAdding(true);
    
    try {
      const finalContent = selectedExampleData.content;
      
      // For FAQ sections with related_features, use centralized mode (remove inline items)
      let sectionContent = { ...finalContent };
      if (selectedComponent.type === "faq" && selectedRelatedFeatures.length > 0) {
        sectionContent = {
          title: (finalContent.title as string) || "Frequently Asked Questions",
          related_features: selectedRelatedFeatures,
        };
      }

      const effectiveInsertIndex = resolveInsertIndex(selectedComponent.type);
      const operations: Array<Record<string, unknown>> = [];
      let sectionToAdd: Record<string, unknown> = {
        type: selectedComponent.type,
        version: selectedVersion,
        ...sectionContent,
      };

      if (opts?.shareToc && selectedComponent.type === "article") {
        const groupId = resolveTocGroupId(existingArticles);
        const { ops: siblingOps, newShowToc } = buildSiblingTocGroupOps(
          existingArticles,
          effectiveInsertIndex,
          groupId,
        );
        operations.push(...siblingOps);
        sectionToAdd = {
          ...sectionToAdd,
          toc_group: groupId,
          show_toc: newShowToc,
          ...(newShowToc && !sectionToAdd.toc_position ? { toc_position: "side" } : {}),
        };
      }

      operations.push({
        action: "add_item",
        path: "sections",
        item: sectionToAdd,
        index: effectiveInsertIndex,
      });

      const token = getDebugToken();
      const author = await resolveAuthorName();
      const response = await fetch("/api/content/edit-sections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Token ${token}` } : {}),
        },
        body: JSON.stringify({
          contentType,
          slug,
          locale,
          variant,
          version,
          author,
          ...(isSharedTemplate && variant ? { layoutTarget: "type_template" } : {}),
          operations,
        }),
      });

      if (response.ok) {
        onClose();
        emitContentUpdated({ contentType: contentType!, slug: slug!, locale: locale! });
        scrollAfterSchemaOrgAdd(selectedComponent.type);
        toast({
          title: "Section added",
          description: opts?.shareToc
            ? `${selectedComponent?.label || "Section"} continues the existing article (one TOC and reading time on the first article).`
            : `${selectedComponent?.label || "Section"} added to the page.`,
        });
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error("Failed to add section:", errorData);
        toast({
          title: "Failed to add section",
          description: errorData.error || "Unknown error occurred",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error adding section:", error);
    } finally {
      setIsAdding(false);
    }
  };

  const executePerEntryAddSection = async (opts?: { shareToc?: boolean }) => {
    if (!selectedExampleData || !selectedComponent || !contentType || !slug || !locale) return;
    setIsAdding(true);
    try {
      let finalContent = selectedExampleData.content;
      if (selectedComponent.type === "faq" && selectedRelatedFeatures.length > 0) {
        finalContent = {
          title: (finalContent.title as string) || "Frequently Asked Questions",
          related_features: selectedRelatedFeatures,
        };
      }
      let sectionData: Record<string, unknown> = {
        type: selectedComponent.type,
        version: selectedVersion,
        ...finalContent,
      };

      const effectiveInsertIndex = resolveInsertIndex(selectedComponent.type);

      // Per-entry path: stamp toc_group on the new article; sibling updates go through
      // edit-sections when possible so existing articles join the same group.
      if (opts?.shareToc && selectedComponent.type === "article") {
        const groupId = resolveTocGroupId(existingArticles);
        const { ops: siblingOps, newShowToc } = buildSiblingTocGroupOps(
          existingArticles,
          effectiveInsertIndex,
          groupId,
        );
        sectionData = {
          ...sectionData,
          toc_group: groupId,
          show_toc: newShowToc,
          ...(newShowToc && !sectionData.toc_position ? { toc_position: "side" } : {}),
        };
        if (siblingOps.length > 0) {
          const token = getDebugToken();
          const author = await resolveAuthorName();
          await fetch("/api/content/edit-sections", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Token ${token}` } : {}),
            },
            body: JSON.stringify({
              contentType,
              slug,
              locale,
              variant,
              version,
              author,
              operations: siblingOps,
            }),
          });
        }
      }

      const token = getDebugToken();
      const resp = await fetch("/api/per-entry-section-add", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify({ contentType, slug, locale, sectionData, insertIndex: effectiveInsertIndex }),
      });
      if (resp.ok) {
        onClose();
        emitContentUpdated({ contentType, slug, locale });
        scrollAfterSchemaOrgAdd(selectedComponent.type);
        toast({
          title: "Section added",
          description: opts?.shareToc
            ? `${selectedComponent.label} continues the existing article (one TOC and reading time on the first article).`
            : `${selectedComponent.label} added to this entry only.`,
        });
      } else {
        const err = await resp.json().catch(() => ({}));
        toast({ title: "Failed to add section", description: err.error || "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error adding section", variant: "destructive" });
    } finally {
      setIsAdding(false);
    }
  };

  const runAddSection = async (opts?: { shareToc?: boolean }) => {
    if (effectiveAddScope === "entry") {
      await executePerEntryAddSection(opts);
      return;
    }
    if (effectiveAddScope === "template") {
      await executeAddSection(opts);
      return;
    }
    if (isSharedTemplate && !variant) {
      pendingAddFn.current = () => executeAddSection(opts);
      setAddWarnOpen(true);
      return;
    }
    await executeAddSection(opts);
  };

  const handleAddSection = async () => {
    // 2+ articles on a page always continue one piece — no share choice.
    const continueArticle =
      selectedComponent?.type === "article" && existingArticles.length >= 1;
    await runAddSection(continueArticle ? { shareToc: true } : undefined);
  };

  const previewUrl = (() => {
    if (!selectedComponent || !selectedVersion || !selectedExample) {
      return null;
    }
    const exampleData = examples.find(e => e.slug === selectedExample);
    if (!exampleData) return null;
    return `/private/component-showcase/${selectedComponent.type}/preview?version=${selectedVersion}&example=${encodeURIComponent(exampleData.name)}&debug=false`;
  })();

  const groupedExamples = (() => {
    const grouped = examples.reduce((acc, ex) => {
      const variant = ex.variant;
      if (!acc[variant]) acc[variant] = [];
      acc[variant].push(ex);
      return acc;
    }, {} as Record<string, ProcessedExample[]>);
    
    const variantOrder = ['singleColumn', 'showcase', 'productShowcase', 'simpleTwoColumn', 'default'];
    const sortedVariants = Object.keys(grouped).sort((a, b) => {
      const aIdx = variantOrder.indexOf(a);
      const bIdx = variantOrder.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
    
    return { grouped, sortedVariants };
  })();

  const exampleSelectItems = (() => {
    const { grouped, sortedVariants } = groupedExamples;
    
    if (sortedVariants.length === 0) {
      return (
        <SelectItem value="no examples available" disabled>
          No examples available
        </SelectItem>
      );
    }
    
    if (sortedVariants.length === 1 && sortedVariants[0] === 'default') {
      return grouped['default'].map(ex => (
        <SelectItem key={ex.slug} value={ex.slug}>{ex.name}</SelectItem>
      ));
    }
    
    return sortedVariants.map(variant => (
      <SelectGroup key={variant}>
        <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wide">
          {variantLabels[variant] || variant}
        </SelectLabel>
        {grouped[variant].map(ex => (
          <SelectItem key={ex.slug} value={ex.slug}>{ex.name}</SelectItem>
        ))}
      </SelectGroup>
    ));
  })();

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b flex-shrink-0">
          <DialogTitle>
            {step === "select" ? "Choose a Component" : step === "wizard" ? "Dynamic Table Builder" : `Configure ${selectedComponent?.label}`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {step === "select" ? "Select a component type to add to the page" : step === "wizard" ? "Build a dynamic table step by step" : "Configure the component version and example"}
          </DialogDescription>
        </DialogHeader>
        
        {isSharedTemplate && effectiveAddScope !== "entry" && !variant && (
          <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-md border bg-muted p-3" data-testid="text-shared-template-notice">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-foreground leading-snug">
              {effectiveAddScope === "template" ? (
                <><strong>Shared template:</strong> the section you add will appear on{" "}<strong>every {contentType} page</strong>.</>
              ) : (
                <><strong>Shared template:</strong> the section you add will appear on{" "}<strong>every {contentType} page</strong>, not just this one.</>
              )}
            </p>
          </div>
        )}
        {isSharedTemplate && effectiveAddScope === "entry" && (
          <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-md border bg-muted p-3" data-testid="text-entry-scope-notice">
            <p className="text-sm text-foreground leading-snug">
              Adding to <strong>this entry only</strong> — the shared template will not be affected.
            </p>
          </div>
        )}

        {step === "select" ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <Tabs
              value={activePickerTab}
              onValueChange={(v) => setActivePickerTab(v as "suggested" | "all")}
              className="flex-1 flex flex-col overflow-hidden min-h-0"
            >
              <div className="px-4 pt-3 pb-2 flex-shrink-0 flex items-center gap-4 flex-wrap">
                <ToggleButtonBarList className="flex-shrink-0">
                  <ToggleButtonBarTrigger value="suggested" data-testid="tab-suggested-components">
                    Suggested
                  </ToggleButtonBarTrigger>
                  <ToggleButtonBarTrigger value="all" data-testid="tab-all-components">
                    All Components
                  </ToggleButtonBarTrigger>
                </ToggleButtonBarList>
              </div>

              {/* Suggested Tab */}
              <TabsContent value="suggested" className="flex-1 min-h-0 overflow-hidden mt-0 data-[state=inactive]:hidden flex flex-col">
                <ScrollArea className="flex-1 px-4 pb-4">
                  {suggestionsLoading || isLoadingRegistry ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex flex-col items-center gap-2 p-4 rounded-lg border bg-card animate-pulse"
                        >
                          <div className="w-12 h-12 rounded-full bg-muted" />
                          <div className="w-24 h-3 rounded bg-muted" />
                          <div className="w-16 h-2 rounded bg-muted" />
                        </div>
                      ))}
                    </div>
                  ) : suggestedComponents.length === 0 ? (
                    <div className="py-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
                      <Info className="h-5 w-5" />
                      <p className="text-sm">No suggestions available for this position.</p>
                      <button
                        className="text-sm text-primary underline"
                        onClick={() => setActivePickerTab("all")}
                      >
                        Browse all components
                      </button>
                    </div>
                  ) : (
                    <>
                      {isStartSuggestion && intentLabel && (
                        <p className="text-xs text-muted-foreground mb-3 pt-2">
                          Popular starting points for <strong>{intentLabel}</strong> pages
                        </p>
                      )}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                        {suggestedComponents.map(({ type, label, icon: Icon, description, suggestion }) => {
                          const isAlreadyUsed = alreadyUsedTypes.has(type);
                          const freqPct = Math.round(suggestion.frequency * 100);
                          const tooltipText = suggestion.fromHeuristics
                            ? `Common at this position in the page${intentLabel ? ` for ${intentLabel} pages` : ""}`
                            : isStartSuggestion
                              ? `Popular starting component${intentLabel ? ` for ${intentLabel} pages` : ""}${freqPct > 0 ? ` — ${freqPct}% of sequences` : ""}`
                              : `Often added after ${prevSectionLabel ?? "this component"}${intentLabel ? ` on ${intentLabel} pages` : ""}${freqPct > 0 ? ` — ${freqPct}% frequency` : ""}`;
                          return (
                            <Tooltip key={type}>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => handleSelectComponent({ type, label, icon: Icon, description })}
                                  className="relative flex flex-col items-center gap-2 p-4 rounded-lg border ring-1 ring-primary/40 bg-card hover:border-primary hover:bg-primary/5 transition-all text-left"
                                  data-testid={`component-suggested-${type}`}
                                >
                                  <Badge
                                    variant="secondary"
                                    className="absolute top-2 right-2 text-[10px] px-1.5 py-0"
                                  >
                                    Suggested
                                  </Badge>
                                  {isAlreadyUsed && (
                                    <Badge
                                      variant="outline"
                                      className="absolute top-2 left-2 text-[10px] px-1.5 py-0 opacity-60"
                                    >
                                      Already used
                                    </Badge>
                                  )}
                                  <div className="p-3 rounded-full bg-muted mt-3">
                                    <Icon className="h-6 w-6 text-muted-foreground" />
                                  </div>
                                  <div className="text-center">
                                    <div className="font-medium text-sm">{label}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                                  </div>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-xs text-xs">
                                {tooltipText}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* All Components Tab */}
              <TabsContent value="all" className="flex-1 min-h-0 overflow-hidden mt-0 data-[state=inactive]:hidden flex flex-col">
                <div className="px-4 pt-0 pb-3 flex-shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search components..."
                      value={componentSearch}
                      onChange={(e) => setComponentSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      data-testid="input-search-components"
                    />
                  </div>
                </div>
                <ScrollArea className="flex-1 px-4 pb-4">
                  {isLoadingRegistry ? (
                    <div className="flex items-center justify-center h-full py-12">
                      <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredComponentsList.length === 0 ? (
                    <div className="flex items-center justify-center h-full py-12 text-muted-foreground">
                      {componentSearch ? "No components match your search" : "No components available"}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {filteredComponentsList.map((component) => {
                        const Icon = component.icon;
                        const isAlreadyUsed = alreadyUsedTypes.has(component.type);
                        return (
                          <button
                            key={component.type}
                            onClick={() => handleSelectComponent(component)}
                            className="relative flex flex-col items-center gap-2 p-4 rounded-lg border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left"
                            data-testid={`component-option-${component.type}`}
                          >
                            {isAlreadyUsed && (
                              <Badge
                                variant="outline"
                                className="absolute top-2 right-2 text-[10px] px-1.5 py-0 opacity-60"
                              >
                                Already used
                              </Badge>
                            )}
                            <div className="p-3 rounded-full bg-muted mt-1">
                              <Icon className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <div className="text-center">
                              <div className="font-medium text-sm">{component.label}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{component.description}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        ) : step === "wizard" ? (
          <div className="flex-1 flex flex-col overflow-auto p-4">
            <TableBuilderWizard
              onComplete={handleWizardComplete}
              onCancel={handleBack}
              locale={locale || "en"}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b flex items-center gap-4 flex-shrink-0 flex-wrap">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                Back
              </Button>
              
              <div className="flex items-center gap-4 flex-1 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Version:</span>
                  <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                    <SelectTrigger className="w-24" data-testid="select-version">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Example:</span>
                  <Select value={selectedExample} onValueChange={setSelectedExample}>
                    <SelectTrigger className="w-64" data-testid="select-example">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {exampleSelectItems}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* FAQ-specific: Related features picker */}
              {selectedComponent?.type === "faq" && (
                <div className="w-full border-t pt-3 mt-1">
                  <RelatedFeaturesPicker
                    value={selectedRelatedFeatures}
                    onChange={setSelectedRelatedFeatures}
                    locale={locale || "en"}
                  />
                </div>
              )}
              
              <Button 
                onClick={handleAddSection}
                disabled={!selectedExampleData || isAdding}
                data-testid="button-add-component"
              >
                {isAdding ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Add Section
                  </>
                )}
              </Button>
            </div>
            
            <div className="flex-1 overflow-hidden bg-muted/30">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : previewUrl ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-full border-0"
                  title="Component Preview"
                  data-testid="component-preview-iframe"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Select a version and example to preview
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    <DbTemplateWarningDialog
      open={addWarnOpen}
      onClose={() => { setAddWarnOpen(false); pendingAddFn.current = null; }}
      onConfirm={async () => {
        if (pendingAddFn.current) {
          await pendingAddFn.current();
          pendingAddFn.current = null;
        }
        setAddWarnOpen(false);
      }}
      operation="add"
      contentType={contentType || "page"}
      isLoading={isAdding}
    />

    </>
  );
}
