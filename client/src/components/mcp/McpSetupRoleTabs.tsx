import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface McpSetupRoleOption {
  id: string;
  label: string;
}

export interface McpSetupRoleTabsProps {
  /**
   * `undefined` = nothing selected yet (wizard role step).
   * `null` = all roles (only when `includeAllOption`).
   * string = only that role id.
   */
  value: string | null | undefined;
  onValueChange: (roleId: string | null) => void;
  roles: McpSetupRoleOption[];
  className?: string;
  triggerClassName?: string;
  /** Placeholder when value is undefined. */
  placeholder?: string;
  listTestId?: string;
  /** Offer the unscoped `/mcp` connector. Default true. */
  includeAllOption?: boolean;
}

const ALL_VALUE = "all";

function labelForValue(
  value: string | null | undefined,
  roles: McpSetupRoleOption[],
  includeAllOption: boolean,
): string | null {
  if (value === undefined) return null;
  if (value === null) return includeAllOption ? "All roles" : null;
  const role = roles.find((r) => r.id === value);
  if (!role) return value;
  return includeAllOption ? `Only ${role.label}` : role.label;
}

/** Role scope picker for MCP connector setup (All roles / Only {label}). */
export function McpSetupRoleTabs({
  value,
  onValueChange,
  roles,
  className,
  triggerClassName,
  placeholder = "Select a role",
  listTestId = "select-mcp-setup-role",
  includeAllOption = true,
}: McpSetupRoleTabsProps) {
  const selectValue = value === undefined ? undefined : value ?? ALL_VALUE;
  const displayLabel = labelForValue(value, roles, includeAllOption);

  return (
    <Select
      value={selectValue}
      onValueChange={(v) => onValueChange(v === ALL_VALUE ? null : v)}
    >
      <SelectTrigger
        className={cn("w-full sm:max-w-xs", triggerClassName, className)}
        data-testid={listTestId}
      >
        {displayLabel ? (
          <span className="truncate">{displayLabel}</span>
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent data-testid={`${listTestId}-content`}>
        {includeAllOption ? (
          <SelectItem value={ALL_VALUE} data-testid={`${listTestId}-all`}>
            All roles
          </SelectItem>
        ) : null}
        {roles.map((role) => (
          <SelectItem
            key={role.id}
            value={role.id}
            data-testid={`${listTestId}-${role.id}`}
          >
            {includeAllOption ? `Only ${role.label}` : role.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
