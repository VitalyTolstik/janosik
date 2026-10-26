import type { UIKey } from "./i18n/ui";

/**
 * The pricing page's numbers, in one place. Everything the plan cards and the
 * comparison table say about prices and limits is derived from here, so a
 * change lands once — no drifting between the two languages or between the
 * cards and the table.
 *
 * A `Value` is either a bare number (language-neutral, e.g. `3` boards) or an
 * i18n key for anything carrying words (e.g. `"Unlimited"`, `"100 MB"`).
 * Localised prose — plan names, blurbs, feature bullets, table labels — lives
 * in `i18n/ui.ts` and is referenced by key.
 */

export type PlanId = "selfhost" | "free" | "pro" | "team" | "enterprise";
export type PlanLink = "github" | "waitlist" | "contact";
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
  price: { monthly: Value; annual: Value };
  period: { monthly: UIKey; annual: UIKey };
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
    price: { monthly: 0, annual: 0 },
    period: {
      monthly: "pricing.selfhost.periodM",
      annual: "pricing.selfhost.periodY",
    },
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
    id: "free",
    link: "waitlist",
    price: { monthly: 0, annual: 0 },
    period: {
      monthly: "pricing.free.periodM",
      annual: "pricing.free.periodY",
    },
    limits: {
      boards: 3,
      members: 5,
      storage: "pricing.value.storage.free",
    },
    highlights: [
      planKey("free", "f1"),
      planKey("free", "f2"),
      planKey("free", "f3"),
    ],
  },
  {
    id: "pro",
    link: "waitlist",
    featured: true,
    price: { monthly: 8, annual: 80 },
    period: {
      monthly: "pricing.pro.periodM",
      annual: "pricing.pro.periodY",
    },
    limits: {
      boards: "pricing.value.unlimited",
      members: "pricing.value.unlimited",
      storage: "pricing.value.storage.pro",
    },
    highlights: [
      planKey("pro", "f1"),
      planKey("pro", "f2"),
      planKey("pro", "f3"),
    ],
  },
  {
    id: "team",
    link: "waitlist",
    price: { monthly: 16, annual: 160 },
    period: {
      monthly: "pricing.team.periodM",
      annual: "pricing.team.periodY",
    },
    limits: {
      boards: "pricing.value.unlimited",
      members: "pricing.value.unlimited",
      storage: "pricing.value.storage.team",
    },
    highlights: [
      planKey("team", "f1"),
      planKey("team", "f2"),
      planKey("team", "f3"),
    ],
  },
  {
    id: "enterprise",
    link: "contact",
    price: { monthly: "pricing.value.custom", annual: "pricing.value.custom" },
    period: {
      monthly: "pricing.enterprise.periodM",
      annual: "pricing.enterprise.periodY",
    },
    limits: {
      boards: "pricing.value.unlimited",
      members: "pricing.value.unlimited",
      storage: "pricing.value.custom",
    },
    highlights: [],
  },
];

/** Cards in the plan grid; Enterprise gets its own band instead. */
export const cardPlanIds: PlanId[] = ["selfhost", "free", "pro", "team"];

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
      { labelKey: "pricing.row.views", cells: [true, true, true, true, true] },
      { labelKey: "pricing.row.cards", cells: [true, true, true, true, true] },
      {
        labelKey: "pricing.row.offline",
        cells: [true, true, true, true, true],
      },
      {
        labelKey: "pricing.row.filters",
        cells: [true, true, true, true, true],
      },
    ],
  },
  {
    titleKey: "pricing.cat.collab",
    rows: [
      {
        labelKey: "pricing.row.realtime",
        cells: [true, true, true, true, true],
      },
      { labelKey: "pricing.row.members", cells: limitCells("members") },
      { labelKey: "pricing.row.boards", cells: limitCells("boards") },
      { labelKey: "pricing.row.storage", cells: limitCells("storage") },
      { labelKey: "pricing.row.shares", cells: [true, true, true, true, true] },
    ],
  },
  {
    titleKey: "pricing.cat.admin",
    rows: [
      { labelKey: "pricing.row.admin", cells: [true, true, true, true, true] },
      { labelKey: "pricing.row.roles", cells: [true, true, true, true, true] },
      {
        labelKey: "pricing.row.audit",
        cells: [false, false, false, true, true],
      },
      { labelKey: "pricing.row.sso", cells: [false, false, false, true, true] },
      {
        labelKey: "pricing.row.onprem",
        cells: [true, false, false, false, true],
      },
    ],
  },
  {
    titleKey: "pricing.cat.support",
    rows: [
      {
        labelKey: "pricing.row.hosting",
        cells: [
          "pricing.value.you",
          "pricing.value.us",
          "pricing.value.us",
          "pricing.value.us",
          "pricing.value.youOrUs",
        ],
      },
      {
        labelKey: "pricing.row.updates",
        cells: [
          "pricing.value.you",
          "pricing.value.auto",
          "pricing.value.auto",
          "pricing.value.auto",
          "pricing.value.managed",
        ],
      },
      {
        labelKey: "pricing.row.support",
        cells: [
          "pricing.value.community",
          "pricing.value.community",
          "pricing.value.email",
          "pricing.value.priority",
          "pricing.value.dedicated",
        ],
      },
      {
        labelKey: "pricing.row.sla",
        cells: [false, false, false, false, true],
      },
    ],
  },
];

/** Plan ids in the order the comparison table's columns expect them. */
export const columnIds: PlanId[] = planOrder;
