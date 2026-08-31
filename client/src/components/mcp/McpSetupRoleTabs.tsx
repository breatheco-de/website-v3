import {
  ToggleButtonBar,
  ToggleButtonBarTrigger,
} from "@/components/ui/toggle-button-bar";
import { cn } from "@/lib/utils";

export interface McpSetupRoleOption {
  id: string;
  label: string;
}

export interface McpSetupRoleTabsProps {
  /** null = all roles */
  value: string | null;
  onValueChange: (roleId: string | null) => void;
  roles: McpSetupRoleOption[];
  className?: string;
  listTestId?: string;
}

/** Role scope picker for MCP connector setup (All roles / Only {label}). */
export function McpSetupRoleTabs({
  value,
  onValueChange,
  roles,
  className,
  listTestId = "tabs-mcp-setup-role",
}: McpSetupRoleTabsProps) {
  return (
    <ToggleButtonBar
      value={value ?? "all"}
      onValueChange={(v) => onValueChange(v === "all" ? null : v)}
      className={cn(className)}
      listTestId={listTestId}
    >
      <ToggleButtonBarTrigger value="all" aria-label="All roles" data-testid="tab-setup-role-all">
        All roles
      </ToggleButtonBarTrigger>
      {roles.map((role) => (
        <ToggleButtonBarTrigger
          key={role.id}
          value={role.id}
          aria-label={`Only ${role.label}`}
          data-testid={`tab-setup-role-${role.id}`}
        >
          Only {role.label}
        </ToggleButtonBarTrigger>
      ))}
    </ToggleButtonBar>
  );
}
