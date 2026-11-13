import { useState } from "react";

import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

import {
  DEFAULT_GUIDED_SCHEDULE,
  formatGuidedSchedule,
  parseGuidedSchedule,
} from "./task-schedule";
import { GuidedScheduleControls } from "./task-schedule-controls";

const FREQUENCIES = [
  { value: "manual", label: "Sob demanda" },
  { value: "interval", label: "A cada intervalo" },
  { value: "hourly", label: "A cada hora" },
  { value: "daily", label: "Todos os dias" },
  { value: "weekly", label: "Em dias da semana" },
  { value: "custom", label: "Cron personalizado" },
] as const;

type ScheduleEditorProps = {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": boolean;
};

function FrequencySelect(props: ScheduleEditorProps) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger
        id={props.id}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        onBlur={props.onBlur}
        className="w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FREQUENCIES.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CustomCronField(props: ScheduleEditorProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${props.id}-expression`}>Expressão cron</Label>
      <Input
        id={`${props.id}-expression`}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        className="font-mono"
        autoComplete="off"
        spellCheck={false}
        placeholder="0 3 * * *"
        value={props.value}
        onBlur={props.onBlur}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}

function GeneratedCron({ value }: { readonly value: string }) {
  return (
    <details className="rounded-lg bg-secondary/50 px-3 py-2">
      <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
        Ver expressão cron
      </summary>
      <code className="mt-2 block font-mono text-sm">{value}</code>
    </details>
  );
}

/** Detects existing schedules and generates cron from choices without saving or running tasks. */
export function TaskScheduleEditor(props: ScheduleEditorProps) {
  const [custom, setCustom] = useState(false);
  const schedule = parseGuidedSchedule(props.value);
  const frequency = custom || schedule == null ? "custom" : schedule.frequency;
  const chooseFrequency = (selected: string) => {
    const option = FREQUENCIES.find((candidate) => candidate.value === selected);
    if (option == null) {
      throw new RangeError("Unknown task schedule frequency");
    }
    setCustom(option.value === "custom");
    if (option.value !== "custom") {
      props.onChange(
        formatGuidedSchedule({ ...(schedule ?? DEFAULT_GUIDED_SCHEDULE), frequency: option.value }),
      );
    }
  };
  return (
    <div className="space-y-3">
      <FrequencySelect {...props} value={frequency} onChange={chooseFrequency} />
      {frequency === "custom" ? (
        <CustomCronField {...props} />
      ) : (
        <GuidedScheduleControls
          id={props.id}
          schedule={schedule ?? DEFAULT_GUIDED_SCHEDULE}
          describedBy={props["aria-describedby"]}
          onChange={(next) => props.onChange(formatGuidedSchedule(next))}
        />
      )}
      {frequency === "manual" || frequency === "custom" ? null : (
        <GeneratedCron value={props.value} />
      )}
    </div>
  );
}
