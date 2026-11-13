import { CheckIcon } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

import { type GuidedSchedule, SCHEDULE_INTERVALS_IN_MINUTES } from "./task-schedule";

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const HOURS = Array.from({ length: HOURS_PER_DAY }, (_, index) => index);
const MINUTES = Array.from({ length: MINUTES_PER_HOUR }, (_, index) => index);
const WEEKDAYS = [
  { value: 1, label: "Seg", name: "Segunda-feira" },
  { value: 2, label: "Ter", name: "Terça-feira" },
  { value: 3, label: "Qua", name: "Quarta-feira" },
  { value: 4, label: "Qui", name: "Quinta-feira" },
  { value: 5, label: "Sex", name: "Sexta-feira" },
  { value: 6, label: "Sáb", name: "Sábado" },
  { value: 0, label: "Dom", name: "Domingo" },
] as const;

function NumberSelect({
  id,
  label,
  values,
  value,
  onChange,
  describedBy,
}: {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly describedBy: string | undefined;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={String(value)}
        onValueChange={(selected) => {
          const option = values.find((candidate) => String(candidate) === selected);
          if (option == null) {
            throw new RangeError("Unknown guided schedule option");
          }
          onChange(option);
        }}
      >
        <SelectTrigger id={id} aria-describedby={describedBy} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {String(option).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function WeekdayButtons({
  id,
  days,
  onChange,
}: {
  readonly id: string;
  readonly days: readonly number[];
  readonly onChange: (days: readonly number[]) => void;
}) {
  return (
    <div className="col-span-2 space-y-1.5">
      <p id={`${id}-days-label`} className="text-sm font-medium">
        Dias da semana
      </p>
      <div
        role="group"
        aria-labelledby={`${id}-days-label`}
        aria-describedby={`${id}-days-hint`}
        className="flex flex-wrap gap-1.5"
      >
        {WEEKDAYS.map((day) => {
          const selected = days.includes(day.value);
          return (
            <Button
              key={day.value}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              aria-label={day.name}
              aria-pressed={selected}
              disabled={selected && days.length === 1}
              onClick={() =>
                onChange(
                  selected ? days.filter((value) => value !== day.value) : [...days, day.value],
                )
              }
            >
              {selected ? <CheckIcon aria-hidden className="size-3" /> : null}
              {day.label}
            </Button>
          );
        })}
      </div>
      <p id={`${id}-days-hint`} className="text-xs text-faint">
        Selecione pelo menos um dia.
      </p>
    </div>
  );
}

/** Frequency-specific controls; choosing values only updates the draft expression. */
export function GuidedScheduleControls({
  id,
  schedule,
  onChange,
  describedBy,
}: {
  readonly id: string;
  readonly schedule: GuidedSchedule;
  readonly onChange: (schedule: GuidedSchedule) => void;
  readonly describedBy: string | undefined;
}) {
  if (schedule.frequency === "manual") {
    return null;
  }
  if (schedule.frequency === "interval") {
    return (
      <NumberSelect
        id={`${id}-interval`}
        label="Intervalo (minutos)"
        values={SCHEDULE_INTERVALS_IN_MINUTES}
        value={schedule.intervalInMinutes}
        describedBy={describedBy}
        onChange={(intervalInMinutes) => onChange({ ...schedule, intervalInMinutes })}
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {schedule.frequency === "hourly" ? null : (
        <NumberSelect
          id={`${id}-hour`}
          label="Hora"
          values={HOURS}
          value={schedule.hour}
          describedBy={describedBy}
          onChange={(hour) => onChange({ ...schedule, hour })}
        />
      )}
      <NumberSelect
        id={`${id}-minute`}
        label="Minuto"
        values={MINUTES}
        value={schedule.minute}
        describedBy={describedBy}
        onChange={(minute) => onChange({ ...schedule, minute })}
      />
      {schedule.frequency === "weekly" ? (
        <WeekdayButtons
          id={id}
          days={schedule.days}
          onChange={(days) => onChange({ ...schedule, days })}
        />
      ) : null}
    </div>
  );
}
