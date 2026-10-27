import type { APIRoute } from "astro";

import { site } from "../config";
import { ui } from "../i18n/ui";
import {
  columnIds,
  comparison,
  currency,
  planKey,
  plans,
  type Cell,
} from "../pricing";

// `/pricing.md` — the pricing page as machine-readable Markdown, so AI agents
// comparing tools can read plans and limits without rendering JavaScript (see
// the ai-seo skill). Derived from `pricing.ts`, the single source of truth.
const value = (cell: Cell): string => {
  if (typeof cell === "boolean") return cell ? "Yes" : "—";
  return typeof cell === "number" ? String(cell) : ui.en[cell];
};

const planSection = plans
  .map((plan) => {
    const name = ui.en[planKey(plan.id, "name")];
    const price =
      typeof plan.price === "number"
        ? `${currency}${plan.price}`
        : ui.en[plan.price];
    const limits = [
      `Boards: ${value(plan.limits.boards)}`,
      `Members: ${value(plan.limits.members)}`,
      `Storage: ${value(plan.limits.storage)}`,
    ];
    const highlights = plan.highlights
      .map((key) => `  - ${ui.en[key]}`)
      .join("\n");
    return [
      `### ${name}`,
      `- Price: ${price} (${ui.en[plan.period]})`,
      ...limits.map((line) => `- ${line}`),
      highlights ? `- Includes:\n${highlights}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  })
  .join("\n\n");

const tableHeader = `| Feature | ${columnIds
  .map((id) => ui.en[planKey(id, "name")])
  .join(" | ")} |`;
const tableDivider = `| --- | ${columnIds.map(() => "---").join(" | ")} |`;
const tableBody = comparison
  .map((category) => {
    const heading = `| **${ui.en[category.titleKey]}** | ${columnIds
      .map(() => "")
      .join(" | ")} |`;
    const rows = category.rows
      .map(
        (row) =>
          `| ${ui.en[row.labelKey]} | ${row.cells.map(value).join(" | ")} |`,
      )
      .join("\n");
    return `${heading}\n${rows}`;
  })
  .join("\n");

export const GET: APIRoute = ({ site: astroSite }) => {
  const abs = (path: string) =>
    new URL(path, astroSite ?? "https://janosik.app").href;

  const body = `# Pricing — ${site.name}

${ui.en["seo.pricing.description"]}

${ui.en["pricing.note"]}

## Plans

${planSection}

## Comparison

${tableHeader}
${tableDivider}
${tableBody}

## More

- [Pricing page](${abs("/pricing/")})
- [Documentation](${abs("/docs/")})
- [Source code](${site.githubUrl})
- License: AGPL-3.0 — ${site.githubUrl}/blob/main/LICENSE
- Contact: ${site.contactEmail}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
