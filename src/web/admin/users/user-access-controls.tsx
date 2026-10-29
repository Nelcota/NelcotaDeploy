import type { ComponentProps } from "react";

import { type Role, ROLES } from "@/shared/roles";
import { ROLE_LABELS } from "@/web/components/layout/labels";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";

/** Dropdown with every role, reporting only values that are real roles. */
export function RoleSelect({
  value,
  onChange,
  triggerProps,
}: {
  readonly value: Role;
  readonly onChange: (role: Role) => void;
  readonly triggerProps: ComponentProps<typeof SelectTrigger>;
}) {
  return (
    <Select
      value={value}
      onValueChange={(selected) => {
        const role = ROLES.find((candidate) => candidate === selected);
        if (role != null) {
          onChange(role);
        }
      }}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Role dropdown and active switch of another user's account. */
export function UserAccessControls({
  user,
  onRoleChange,
  onActiveChange,
}: {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly role: Role;
    readonly disabled: boolean;
  };
  readonly onRoleChange: (role: Role) => void;
  readonly onActiveChange: (active: boolean) => void;
}) {
  const switchId = `user-active-${user.id}`;
  return (
    <>
      <RoleSelect
        value={user.role}
        onChange={onRoleChange}
        triggerProps={{ "aria-label": `Papel de ${user.name}`, className: "w-40", size: "sm" }}
      />
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          aria-label={`${user.name} ativo`}
          checked={user.disabled === false}
          onCheckedChange={onActiveChange}
        />
        <Label htmlFor={switchId} aria-hidden className="text-sm font-normal">
          Ativo
        </Label>
      </div>
    </>
  );
}
