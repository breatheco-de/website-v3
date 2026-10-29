import { useState } from "react";
import { AlertTriangle, ArrowRight, Menu, RefreshCw, X } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isSlug } from "@shared/slug";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ContentTypeItem {
  name: string;
  label: string;
  layout?: {
    menu?: {
      top?: string | null;
      bottom?: string | null;
    };
  };
}

interface SlotAssignment {
  top: boolean;
  bottom: boolean;
}

interface CreateMenuModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function toSlugTyping(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-");
}

export function CreateMenuModal({ open, onOpenChange }: CreateMenuModalProps) {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [assignments, setAssignments] = useState<Record<string, SlotAssignment>>({});
  const [focusedCt, setFocusedCt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: contentTypes } = useQuery<ContentTypeItem[]>({
    queryKey: ["/api/content-types"],
    enabled: open,
  });

  const slugValid = name === "" || isSlug(name);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/menus", { name });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create menu");
      }
      return res.json();
    },
    onSuccess: async (data: { name: string }) => {
      // Apply content type assignments
      const assignmentPromises: Promise<Response>[] = [];
      for (const [ctType, slots] of Object.entries(assignments)) {
        if (!slots.top && !slots.bottom) continue;
        const menuUpdate: { top?: string; bottom?: string } = {};
        if (slots.top) menuUpdate.top = data.name;
        if (slots.bottom) menuUpdate.bottom = data.name;
        assignmentPromises.push(
          apiRequest("PUT", `/api/content-types/${ctType}/layout`, {
            menu: menuUpdate,
          })
        );
      }

      // Wait for all assignments to complete (failures will throw)
      await Promise.all(assignmentPromises);

      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });

      onOpenChange(false);
      navigate(`/private/menu-editor/${data.name}`);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleClose = (open: boolean) => {
    if (!open) {
      setName("");
      setAssignments({});
      setFocusedCt(null);
      setError(null);
    }
    onOpenChange(open);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(toSlugTyping(e.target.value));
    setError(null);
  };

  const toggleSlot = (ctType: string, slot: "top" | "bottom") => {
    setAssignments((prev) => {
      const current = prev[ctType] || { top: false, bottom: false };
      return {
        ...prev,
        [ctType]: { ...current, [slot]: !current[slot] },
      };
    });
  };

  const canSubmit = name.length > 0 && slugValid && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Menu className="h-5 w-5" />
            Create new menu
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label
              htmlFor="menu-name"
              className="text-sm font-medium leading-none"
            >
              Name
            </label>
            <input
              id="menu-name"
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. main-nav"
              className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="input-menu-name"
              disabled={createMutation.isPending}
              autoFocus
            />
            {name && !slugValid && (
              <p className="text-xs text-destructive">
                Only lowercase letters, numbers, and hyphens are allowed.
              </p>
            )}
            {name && slugValid && (
              <p className="text-xs text-muted-foreground">
                File will be saved as{" "}
                <code className="bg-muted px-1 rounded">{name}.yml</code>
              </p>
            )}
          </div>

          {contentTypes && contentTypes.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-sm font-medium leading-none">
                  Assign to content types
                </p>
                <p className="text-xs text-muted-foreground">
                  Choose which content types should use this menu at the top or bottom.
                </p>
              </div>

              <Select
                value={focusedCt ?? ""}
                onValueChange={(val) => setFocusedCt(val)}
                disabled={createMutation.isPending}
              >
                <SelectTrigger data-testid="select-ct-picker">
                  <SelectValue placeholder="Select a content type…" />
                </SelectTrigger>
                <SelectContent>
                  {contentTypes.map((ct) => (
                    <SelectItem key={ct.name} value={ct.name}>
                      {ct.label || ct.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {focusedCt && (() => {
                const ct = contentTypes.find((c) => c.name === focusedCt);
                if (!ct) return null;
                const currentTop = ct.layout?.menu?.top || null;
                const currentBottom = ct.layout?.menu?.bottom || null;
                const slotState = assignments[ct.name] || { top: false, bottom: false };
                return (
                  <div
                    className="space-y-2 pt-1"
                    data-testid={`row-ct-assignment-${ct.name}`}
                  >
                    <p className="text-sm font-medium">
                      {ct.label || ct.name}
                    </p>
                    <div className="flex gap-6">
                      <label
                        htmlFor={`checkbox-top-${ct.name}`}
                        className="flex flex-col items-start gap-0.5 cursor-pointer select-none"
                      >
                        <span className="flex items-center gap-1.5">
                          <input
                            id={`checkbox-top-${ct.name}`}
                            type="checkbox"
                            checked={slotState.top}
                            onChange={() => toggleSlot(ct.name, "top")}
                            disabled={createMutation.isPending}
                            data-testid={`checkbox-ct-top-${ct.name}`}
                            className="rounded"
                          />
                          <span className="text-xs">Top</span>
                        </span>
                        {currentTop && (
                          <span className="text-xs text-muted-foreground pl-5">
                            currently: {currentTop}
                          </span>
                        )}
                      </label>
                      <label
                        htmlFor={`checkbox-bottom-${ct.name}`}
                        className="flex flex-col items-start gap-0.5 cursor-pointer select-none"
                      >
                        <span className="flex items-center gap-1.5">
                          <input
                            id={`checkbox-bottom-${ct.name}`}
                            type="checkbox"
                            checked={slotState.bottom}
                            onChange={() => toggleSlot(ct.name, "bottom")}
                            disabled={createMutation.isPending}
                            data-testid={`checkbox-ct-bottom-${ct.name}`}
                            className="rounded"
                          />
                          <span className="text-xs">Bottom</span>
                        </span>
                        {currentBottom && (
                          <span className="text-xs text-muted-foreground pl-5">
                            currently: {currentBottom}
                          </span>
                        )}
                      </label>
                    </div>
                  </div>
                );
              })()}

              {Object.entries(assignments).some(([, s]) => s.top || s.bottom) && (
                <div className="space-y-1 pt-2 border-t">
                  {Object.entries(assignments).flatMap(([ctName, slots]) => {
                    const ct = contentTypes.find((c) => c.name === ctName);
                    const label = ct?.label || ctName;
                    const existingTop = ct?.layout?.menu?.top || null;
                    const existingBottom = ct?.layout?.menu?.bottom || null;
                    const rows: React.ReactNode[] = [];
                    if (slots.top) {
                      rows.push(
                        <div
                          key={`${ctName}-top`}
                          className="flex items-center gap-2"
                          data-testid={`summary-assignment-${ctName}-top`}
                        >
                          <span className="text-sm font-medium flex-1 truncate">
                            {label}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground shrink-0">
                            Top
                            {existingTop && (
                              <span className="ml-1 text-muted-foreground/70">
                                (overrides {existingTop})
                              </span>
                            )}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => toggleSlot(ctName, "top")}
                            disabled={createMutation.isPending}
                            data-testid={`remove-assignment-${ctName}-top`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    }
                    if (slots.bottom) {
                      rows.push(
                        <div
                          key={`${ctName}-bottom`}
                          className="flex items-center gap-2"
                          data-testid={`summary-assignment-${ctName}-bottom`}
                        >
                          <span className="text-sm font-medium flex-1 truncate">
                            {label}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground shrink-0">
                            Bottom
                            {existingBottom && (
                              <span className="ml-1 text-muted-foreground/70">
                                (overrides {existingBottom})
                              </span>
                            )}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => toggleSlot(ctName, "bottom")}
                            disabled={createMutation.isPending}
                            data-testid={`remove-assignment-${ctName}-bottom`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    }
                    return rows;
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleClose(false)}
            disabled={createMutation.isPending}
            data-testid="button-cancel-create-menu"
          >
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit}
            data-testid="button-confirm-create-menu"
          >
            {createMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                Creating…
              </>
            ) : (
              "Create menu"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
