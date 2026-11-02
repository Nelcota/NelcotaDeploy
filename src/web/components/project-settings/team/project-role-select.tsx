import { PROJECT_ROLES, type ProjectRole } from "@/shared/roles";
import { ROLE_LABELS } from "@/web/components/layout/labels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

/** Dropdown with the roles a member can have on a project. */
export function ProjectRoleSelect({
  id,
  label,
  value,
  disabled = false,
  onChange,
}: {
  readonly id?: string;
  /** Accessible name, when no visible label points at the dropdown. */
  readonly label?: string;
  readonly value: ProjectRole;
  readonly disabled?: boolean;
  readonly onChange: (role: ProjectRole) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(selected) => {
        const role = PROJECT_ROLES.find((candidate) => candidate === selected);
        if (role != null) {
          onChange(role);
        }
      }}
    >
      <SelectTrigger id={id} aria-label={label} className="w-full sm:w-40" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROJECT_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
