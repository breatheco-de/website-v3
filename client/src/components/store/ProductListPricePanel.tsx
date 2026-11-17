import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import { resolveVariable, type VariableDefinition } from "@/lib/variable-manager";
import { IconLoader2 } from "@tabler/icons-react";

const NONE = "__none__";

type ProductResponse = {
  product?: {
    pricing?: { list_price_variable?: string };
    content_slug?: string;
  };
};

export function ProductListPricePanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const { data: productData, isLoading } = useQuery<ProductResponse>({
    queryKey: ["/api/product", slug],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/product/${encodeURIComponent(slug)}?content_type=program`);
      return res.json();
    },
  });
  const { data: definitions } = useVariableDefinitions();
  const varContext = useVariableContext();
  const current = productData?.product?.pricing?.list_price_variable ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const selected = draft ?? current;

  const priceOptions = useMemo(() => {
    if (!definitions) return [];
    return Object.entries(definitions as Record<string, VariableDefinition>)
      .filter(([, def]) => {
        if (def.category !== "price") return false;
        const products = Array.isArray(def.products) ? def.products : [];
        return products.includes(slug);
      })
      .map(([name, def]) => {
        const resolved = resolveVariable(name, definitions as Record<string, VariableDefinition>, varContext);
        return {
          name,
          label: `${name}${resolved?.value ? ` → ${resolved.value}` : ""}`,
          role: def.price_role,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [definitions, slug, varContext]);

  const preview = selected
    ? resolveVariable(selected, (definitions ?? {}) as Record<string, VariableDefinition>, varContext)
        ?.value
    : null;

  const save = useMutation({
    mutationFn: async (list_price_variable: string | null) => {
      const res = await apiRequest("PUT", `/api/product/${encodeURIComponent(slug)}`, {
        content_type: "program",
        pricing:
          list_price_variable == null
            ? { list_price_variable: null }
            : { list_price_variable },
      });
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/product", slug] });
      void queryClient.invalidateQueries({ queryKey: ["/api/ecommerce/products"] });
      setDraft(null);
      toast({ title: "List price updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save list price", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center text-muted-foreground">
          <IconLoader2 className="h-5 w-5 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="product-list-price-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Catalog list price</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Which site variable is this product&apos;s full tuition. Used for Course offers in search.
          Monthly prices stay as separate variables and are not set here.
        </p>
        <Select
          value={selected || NONE}
          onValueChange={(v) => setDraft(v === NONE ? "" : v)}
        >
          <SelectTrigger data-testid="select-list-price-variable">
            <SelectValue placeholder="Pick a price variable" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {priceOptions.map((o) => (
              <SelectItem key={o.name} value={o.name}>
                <span className="font-mono text-xs">{o.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preview && (
          <p className="text-xs text-muted-foreground">
            Preview: <span className="font-medium text-foreground">{preview}</span>
          </p>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={save.isPending || (draft === null && selected === current)}
            onClick={() => save.mutate(selected ? selected : null)}
            data-testid="button-save-list-price"
          >
            {save.isPending ? <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Read more (advanced)</summary>
          <p className="pt-1 font-mono">programs/{slug}/_product.yml → pricing.list_price_variable</p>
        </details>
      </CardContent>
    </Card>
  );
}
