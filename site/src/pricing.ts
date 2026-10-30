import type { UIKey } from "./i18n/ui";

/**
 * The pricing page's numbers, in one place. Everything the plan cards and the
 * comparison table say about prices and limits is derived from here, so a
 * change lands once — no drifting between the two languages or between the
 * cards and the table.
 *
 * A `Value` is either a bare number (language-neutral, e.g. `0`) or an i18n
 * key for anything carrying words (e.g. `"Unlimited"`, `"Coming soon"`).
 * Localised prose — plan names, blurbs, feature bullets, table labels — lives
 * in `i18n/ui.ts` and is referenced by key.
 *
 * Only two plans exist today: a free self-hosted edition (open source) and a
 * managed cloud that is not launched yet. Per-seat tiers arrive with the cloud
 * (TASK-131).
 */

export type PlanId = "selfhost" | "cloud";
export type PlanLink = "github" | "waitlist";
export type Value = number | UIKey;
/** A table cell: a boolean (included / not) or a value to print. */
export type Cell = boolean | Value;

/** Prefix for numeric prices. */
export const currency = "$";

export type Plan = {
  id: PlanId;
  /** Where the CTA points; resolved to a URL by the page. */
  link: PlanLink;
  /** Highlighted as the recommended tier. */
  featured?: boolean;
  price: Value;
  period: UIKey;
  limits: { boards: Value; members: Value; storage: Value };
  /** Card bullets — qualitative, referenced by i18n key. */
  highlights: UIKey[];
};

/** `pricing.<id>.<suffix>` — a plan's own i18n key. */
export const planKey = (id: PlanId, suffix: string) =>
  `pricing.${id}.${suffix}` as UIKey;

export const plans: Plan[] = [
  {
    id: "selfhost",
    link: "github",
    featured: true,
    price: 0,
    period: "pricing.selfhost.period",
    limits: {
      boards: "pricing.value.unlimited",
      members: "pricing.value.unlimited",
      storage: "pricing.value.yourDisk",
    },
    highlights: [
      planKey("selfhost", "f1"),
      planKey("selfhost", "f2"),
      planKey("selfhost", "f3"),
    ],
  },
  {
    id: "cloud",
    link: "waitlist",
    price: "pricing.cloud.price",
    period: "pricing.cloud.period",
    limits: {
      boards: "pricing.value.unlimited",
      members: "pricing.value.unlimited",
      storage: "pricing.value.managed",
    },
    highlights: [
      planKey("cloud", "f1"),
      planKey("cloud", "f2"),
      planKey("cloud", "f3"),
    ],
  },
];

/** Cards in the plan grid. */
export const cardPlanIds: PlanId[] = ["selfhost", "cloud"];

const planOrder = plans.map((plan) => plan.id);
export const planById = Object.fromEntries(
  plans.map((plan) => [plan.id, plan]),
) as Record<PlanId, Plan>;

/** A table row's cells, one per plan, straight from the shared limits. */
const limitCells = (field: keyof Plan["limits"]): Cell[] =>
  planOrder.map((id) => planById[id].limits[field]);

export type Category = {
  titleKey: UIKey;
  rows: { labelKey: UIKey; cells: Cell[] }[];
};

/** The comparison table: rows are grouped into categories. */
export const comparison: Category[] = [
  {
    titleKey: "pricing.cat.board",
    rows: [
      { labelKey: "pricing.row.views", cells: [true, true] },
      { labelKey: "pricing.row.cards", cells: [true, true] },
      { labelKey: "pricing.row.offline", cells: [true, true] },
      { labelKey: "pricing.row.filters", cells: [true, true] },
    ],
  },
  {
    titleKey: "pricing.cat.collab",
    rows: [
      { labelKey: "pricing.row.realtime", cells: [true, true] },
      { labelKey: "pricing.row.agents", cells: [true, true] },
      { labelKey: "pricing.row.members", cells: limitCells("members") },
      { labelKey: "pricing.row.boards", cells: limitCells("boards") },
      { labelKey: "pricing.row.storage", cells: limitCells("storage") },
      { labelKey: "pricing.row.shares", cells: [true, true] },
    ],
  },
  {
    titleKey: "pricing.cat.admin",
    rows: [
      { labelKey: "pricing.row.admin", cells: [true, true] },
      { labelKey: "pricing.row.roles", cells: [true, true] },
      { labelKey: "pricing.row.audit", cells: [true, true] },
    ],
  },
  {
    titleKey: "pricing.cat.support",
    rows: [
      {
        labelKey: "pricing.row.hosting",
        cells: ["pricing.value.you", "pricing.value.us"],
      },
      {
        labelKey: "pricing.row.updates",
        cells: ["pricing.value.you", "pricing.value.auto"],
      },
      {
        labelKey: "pricing.row.support",
        cells: ["pricing.value.community", "pricing.value.priority"],
      },
    ],
  },
];

/** Plan ids in the order the comparison table's columns expect them. */
export const columnIds: PlanId[] = planOrder;
