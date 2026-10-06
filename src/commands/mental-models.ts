/**
 * Mental model subcommands: `/hindsight models` and `/hindsight models refresh <id>`.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HindsightClientWrapper } from "../client";
import type { HindsightConfig } from "../config";
import { prefixLog } from "../constants";
import type { Subcommand } from "./types";

/**
 * `/hindsight models [refresh <id>]` — list the bank's mental models with
 * content previews, or force a refresh of one model. `refresh` is a manual,
 * user-initiated write (the only write path this feature adds); listing is
 * read-only.
 */
export function createMentalModelsSubcommand(
  client: HindsightClientWrapper | null,
  config: HindsightConfig
): Subcommand {
  return {
    description: "List bank mental models (or refresh one: models refresh <id>)",
    getArgumentCompletions: async (argumentPrefix: string) => {
      const trimmed = argumentPrefix.trimStart();
      if (trimmed === "" || "refresh".startsWith(trimmed)) {
        return [{ label: "refresh", value: "refresh" }];
      }
      return null;
    },
    handler: async (args: string, ctx: ExtensionContext) => {
      if (!client) {
        ctx.ui.notify("Hindsight client not configured", "error");
        return;
      }

      const trimmed = args.trim();
      if (trimmed === "" || trimmed === "refresh") {
        // List (default). `models refresh` with no id also lists plus usage hint.
        const result = await client.listMentalModels();
        if (!result.success) {
          ctx.ui.notify(prefixLog(`failed to list mental models: ${result.error}`), "error");
          return;
        }
        const items = result.items ?? [];
        if (items.length === 0) {
          ctx.ui.notify(
            "No mental models in this bank. Create them with hindsight-embed or the Hindsight UI.",
            "info"
          );
          return;
        }
        const lines: string[] = [`Mental models in ${config.bankId} (${items.length}):`, ""];
        for (const m of items) {
          const refreshed = m.last_refreshed_at ?? "never";
          const content = (m.content ?? "").replace(/\s+/g, " ").trim();
          const preview = content.length > 120 ? `${content.slice(0, 120)}…` : content;
          lines.push(`  ${m.id} — ${m.name} (refreshed: ${refreshed})`);
          if (preview) lines.push(`    ${preview}`);
        }
        if (trimmed === "refresh") {
          lines.push("", "Usage: /hindsight models refresh <id>");
        }
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      const parts = trimmed.split(/\s+/);
      if (parts[0] !== "refresh" || !parts[1]) {
        ctx.ui.notify(`Unknown argument: ${trimmed}. Usage: models [refresh <id>]`, "error");
        return;
      }

      // Everything after the "refresh" token is the model ID (IDs are
      // alphanumeric lowercase with hyphens, but preserve what the user typed).
      const modelId = trimmed.slice(trimmed.indexOf(parts[1])).trim();
      const refreshResult = await client.refreshMentalModel(modelId);
      if (!refreshResult.success) {
        ctx.ui.notify(prefixLog(`failed to refresh mental model: ${refreshResult.error}`), "error");
        return;
      }
      ctx.ui.notify(
        prefixLog(
          `Refresh started for ${modelId} (operation ${refreshResult.operation?.operation_id ?? "unknown"}, status ${refreshResult.operation?.status ?? "unknown"}). The model updates server-side; re-run /hindsight models to see the new content once it completes.`
        ),
        "info"
      );
    },
  };
}
