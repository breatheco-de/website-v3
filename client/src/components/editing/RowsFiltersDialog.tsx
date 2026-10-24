import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROWS_FILTER_MAX, type RowsFilter } from "@shared/validateEditorFieldTypes";

type DraftFilter = {
  rows_property_slug: string;
  value_from_current_row: string;
};

export function RowsFiltersDialog({
  fieldName,
  open,
  columns,
  initial,
  onOpenChange,
  onApply,
}: {
  fieldName: string;
  open: boolean;
  columns: string[];
  initial: RowsFilter[];
  onOpenChange: (open: boolean) => void;
  onApply: (filters: RowsFilter[]) => void;
}) {
  const [rows, setRows] = useState<DraftFilter[]>(initial);

  useEffect(() => {
    if (open) {
      setRows(initial.length > 0 ? initial.map((row) => ({ ...row })) : [{ rows_property_slug: "", value_from_current_row: "" }]);
    }
  }, [open, initial]);

  const options = Array.from(
    new Set([
      ...columns,
      ...rows.flatMap((row) => [row.rows_property_slug, row.value_from_current_row].filter(Boolean)),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const apply = () => {
    const filters = rows.filter((row) => row.rows_property_slug && row.value_from_current_row);
    onApply(filters);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid={`dialog-rows-filters-${fieldName}`}>
        <DialogHeader>
          <DialogTitle>Rows from database for "{fieldName}"</DialogTitle>
          <DialogDescription>
            This field is filled with other rows from the same database. Compare a column on those
            rows with a column on this row. It brings at most {ROWS_FILTER_MAX} rows — if there are
            more, it stays empty.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Column on the other rows</Label>
                <Select
                  value={row.rows_property_slug || undefined}
                  onValueChange={(value) =>
                    setRows((prev) => prev.map((item, i) => (i === index ? { ...item, rows_property_slug: value } : item)))
                  }
                >
                  <SelectTrigger className="text-xs font-mono" data-testid={`select-rows-property-${fieldName}-${index}`}>
                    <SelectValue placeholder="Column" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((column) => (
                      <SelectItem key={column} value={column} className="text-xs font-mono">
                        {column}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Column on this row</Label>
                <Select
                  value={row.value_from_current_row || undefined}
                  onValueChange={(value) =>
                    setRows((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, value_from_current_row: value } : item)),
                    )
                  }
                >
                  <SelectTrigger className="text-xs font-mono" data-testid={`select-current-row-${fieldName}-${index}`}>
                    <SelectValue placeholder="Column" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((column) => (
                      <SelectItem key={column} value={column} className="text-xs font-mono">
                        {column}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Remove filter"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                data-testid={`button-remove-rows-filter-${fieldName}-${index}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((prev) => [...prev, { rows_property_slug: "", value_from_current_row: "" }])}
            data-testid={`button-add-rows-filter-${fieldName}`}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add filter
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} data-testid={`button-apply-rows-filters-${fieldName}`}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
