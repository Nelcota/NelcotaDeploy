import { createLucideIcon } from "lucide-react";

// Drawn for the panel with a thinner line than Lucide's default and a metaphor tied to what
// each area does. Built on Lucide so they keep its sizing, colors and props.
const THIN_STROKE = { strokeWidth: 1.5 } as const;

/** Overview: a gauge reading the state of everything. */
export const OverviewIcon = createLucideIcon("nelcota-overview", [
  ["path", { d: "M3 15a9 9 0 1 1 18 0", ...THIN_STROKE, key: "dial" }],
  ["path", { d: "m12 15 4.5-5.5", ...THIN_STROKE, key: "needle" }],
  ["circle", { cx: "12", cy: "15", r: "1.4", fill: "currentColor", ...THIN_STROKE, key: "pivot" }],
  ["path", { d: "M3 20h18", ...THIN_STROKE, key: "base" }],
]);

/** Projects: a folder holding a repository. */
export const ProjectsIcon = createLucideIcon("nelcota-projects", [
  [
    "path",
    {
      d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
      ...THIN_STROKE,
      key: "folder",
    },
  ],
  ["circle", { cx: "8.5", cy: "13", r: "2", ...THIN_STROKE, key: "from" }],
  ["circle", { cx: "15.5", cy: "13", r: "2", ...THIN_STROKE, key: "to" }],
  ["path", { d: "M10.5 13h3", ...THIN_STROKE, key: "link" }],
]);

/** Deploys: a container going up from the ground. */
export const DeploysIcon = createLucideIcon("nelcota-deploys", [
  ["rect", { x: "5", y: "10", width: "14", height: "8", rx: "2", ...THIN_STROKE, key: "box" }],
  ["path", { d: "M12 2.5v5M9 5.5l3-3 3 3", ...THIN_STROKE, key: "arrow" }],
  ["path", { d: "M3 21.5h18", ...THIN_STROKE, key: "ground" }],
]);

/** Administration: three sliders tuning the panel. */
export const AdministrationIcon = createLucideIcon("nelcota-administration", [
  ["path", { d: "M4 6h9M17 6h3", ...THIN_STROKE, key: "top-line" }],
  ["circle", { cx: "15", cy: "6", r: "2", ...THIN_STROKE, key: "top-knob" }],
  ["path", { d: "M4 12h3M11 12h9", ...THIN_STROKE, key: "middle-line" }],
  ["circle", { cx: "9", cy: "12", r: "2", ...THIN_STROKE, key: "middle-knob" }],
  ["path", { d: "M4 18h11M19 18h1", ...THIN_STROKE, key: "bottom-line" }],
  ["circle", { cx: "17", cy: "18", r: "2", ...THIN_STROKE, key: "bottom-knob" }],
]);
