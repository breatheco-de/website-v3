import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatMoneyValue,
  normalizeMoneyValue,
  type MoneyValue,
  type VariableValue,
} from "@shared/variable-money";

const CURRENCIES = ["USD", "EUR", "GBP"] as const;

export function MoneyValueFields({
  value,
  onChange,
  testIdPrefix = "money",
  locale = "en",
}: {
  value: VariableValue | undefined;
  onChange: (next: MoneyValue) => void;
  testIdPrefix?: string;
  locale?: string;
}) {
  const parsed = normalizeMoneyValue(value);
  const amount = parsed?.amount ?? 0;
  const currency = parsed?.currency ?? "USD";
  const display = parsed?.display ?? "";

  const emit = (nextAmount: number, nextCurrency: string, nextDisplay: string) => {
    const next: MoneyValue = {
      amount: nextAmount,
      currency: nextCurrency,
      ...(nextDisplay.trim() ? { display: nextDisplay.trim() } : {}),
    };
    onChange(next);
  };

  const preview = formatMoneyValue(
    { amount, currency, ...(display ? { display } : {}) },
    { locale },
  );

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-fields`}>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Amount</span>
          <Input
            type="number"
            min={0}
            step="any"
            value={Number.isFinite(amount) ? amount : ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              emit(Number.isFinite(n) ? n : 0, currency, display);
            }}
            data-testid={`${testIdPrefix}-amount`}
          />
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Currency</span>
          <Select value={currency} onValueChange={(v) => emit(amount, v, display)}>
            <SelectTrigger className="w-[100px]" data-testid={`${testIdPrefix}-currency`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10002]">
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Display override (optional)</span>
        <Input
          value={display}
          onChange={(e) => emit(amount, currency, e.target.value)}
          placeholder="Leave empty to auto-format"
          data-testid={`${testIdPrefix}-display`}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Visitors see: <span className="font-medium text-foreground">{preview}</span>
      </p>
    </div>
  );
}
