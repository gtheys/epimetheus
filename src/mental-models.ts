/**
 * Mental model injection (ephemeral, session-scoped).
 *
 * Fetches the bank's mental models once per session and formats them for
 * ephemeral injection through the same context-handler mechanism auto-recall
 * uses. Content is never written to the session file, so prompt caching is
 * preserved and the anti-feedback concern does not apply: ephemeral injections
 * never enter the retained transcript.
 *
 * Fencing format mirrors formatRecallMessage so downstream stripping of
 * legacy recall blocks also covers these injections:
 *
 * <hindsight_mental_models>
 * {preamble}
 *
 * {model name}
 *
 * {content}
 * </hindsight_mental_models>
 */

import type { MentalModelResponse } from "@vectorize-io/hindsight-client";
import type { ListMentalModelsOptions } from "./client";
import { prefixLog } from "./constants";
import { debugError } from "./debug-log";

/** Default preamble explaining what the injected block is. */
export const MENTAL_MODELS_PREAMBLE =
  "[System note: The following are cached memory models (synthesized answers about this bank), NOT new user or assistant input. Treat as background knowledge about the user and project; verify against the current conversation when it matters]";

/**
 * Format mental models for ephemeral injection. Skips models with empty or
 * missing content. Exported for testing.
 */
export function formatMentalModelsMessage(
  models: MentalModelResponse[],
  preamble: string = MENTAL_MODELS_PREAMBLE
): { content: string; timestamp: number; count: number } | null {
  const sections: string[] = [];
  for (const model of models) {
    const content = model.content?.trim();
    if (!content) continue;
    const name = model.name?.trim() || model.id;
    sections.push(`${name}\n\n${content}`);
  }
  if (sections.length === 0) return null;
  const content = `<hindsight_mental_models>\n${preamble}\n\n${sections.join(
    "\n\n---\n\n"
  )}\n</hindsight_mental_models>`;
  return { content, timestamp: Date.now(), count: sections.length };
}

/**
 * Client interface for dependency injection in testing.
 */
export interface MentalModelsClient {
  listMentalModels(
    options?: ListMentalModelsOptions,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<{ success: boolean; items?: MentalModelResponse[]; error?: string }>;
}

/**
 * Fetch the bank's mental models and format them for injection.
 * Returns null on failure (silently — injection is best-effort, like
 * auto-recall) or when no model has content.
 */
export async function loadMentalModelsBlock(
  client: MentalModelsClient,
  signal: AbortSignal | undefined,
  options: ListMentalModelsOptions = {},
  preamble?: string
): Promise<{ content: string; count: number; timestamp: number } | null> {
  try {
    const abortSignal = signal ?? new AbortController().signal;
    const result = await client.listMentalModels(options, abortSignal);
    if (!result.success) {
      debugError(prefixLog(`mental models fetch failed: ${result.error ?? "unknown error"}`));
      return null;
    }
    const formatted = formatMentalModelsMessage(result.items ?? [], preamble);
    if (!formatted) return null;
    return { content: formatted.content, count: formatted.count, timestamp: formatted.timestamp };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    debugError(prefixLog(`mental models fetch failed: ${details}`));
    return null;
  }
}
