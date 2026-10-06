/**
 * Unit tests for mental model support:
 * - formatMentalModelsMessage / loadMentalModelsBlock (src/mental-models.ts)
 * - HindsightClientWrapper mental model methods (src/client.ts)
 * - /hindsight models subcommand (src/commands/mental-models.ts)
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { MentalModelResponse } from "@vectorize-io/hindsight-client";
import { HindsightClientWrapper } from "../src/client";
import { createMentalModelsSubcommand } from "../src/commands/mental-models";
import {
  formatMentalModelsMessage,
  loadMentalModelsBlock,
  MENTAL_MODELS_PREAMBLE,
  type MentalModelsClient,
} from "../src/mental-models";
import { testConfig } from "./fixtures";

function makeModel(overrides: Partial<MentalModelResponse> = {}): MentalModelResponse {
  return {
    id: "user-preferences",
    bank_id: "test-bank",
    name: "User Preferences",
    content: "Prefers uv over pip. Dislikes heavy prompts.",
    tags: [],
    last_refreshed_at: "2026-10-06T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  } as MentalModelResponse;
}

describe("formatMentalModelsMessage", () => {
  it("returns null for an empty model list", () => {
    expect(formatMentalModelsMessage([])).toBeNull();
  });

  it("returns null when no model has content", () => {
    expect(
      formatMentalModelsMessage([makeModel({ content: null }), makeModel({ content: "" })])
    ).toBeNull();
  });

  it("skips models without content but includes the rest", () => {
    const result = formatMentalModelsMessage([
      makeModel({ id: "empty", name: "Empty", content: null }),
      makeModel(),
    ]);
    expect(result).not.toBeNull();
    expect(result?.count).toBe(1);
    expect(result?.content).toContain("Prefers uv over pip");
    expect(result?.content).not.toContain("Empty");
  });

  it("wraps content in hindsight_mental_models tags with the preamble", () => {
    const result = formatMentalModelsMessage([makeModel()]);
    expect(result?.content.startsWith("<hindsight_mental_models>")).toBe(true);
    expect(result?.content.endsWith("</hindsight_mental_models>")).toBe(true);
    expect(result?.content).toContain(MENTAL_MODELS_PREAMBLE);
  });

  it("uses the model name as a section header", () => {
    const result = formatMentalModelsMessage([makeModel()]);
    expect(result?.content).toContain("User Preferences");
  });

  it("falls back to the model id when the name is blank", () => {
    const result = formatMentalModelsMessage([makeModel({ name: "  " })]);
    expect(result?.content).toContain("user-preferences");
  });

  it("separates multiple models with --- dividers", () => {
    const result = formatMentalModelsMessage([
      makeModel({ id: "a", name: "A", content: "alpha" }),
      makeModel({ id: "b", name: "B", content: "beta" }),
    ]);
    expect(result?.count).toBe(2);
    expect(result?.content).toContain("---");
    expect(result?.content).toContain("alpha");
    expect(result?.content).toContain("beta");
  });
});

describe("loadMentalModelsBlock", () => {
  function makeClient(result: {
    success: boolean;
    items?: MentalModelResponse[];
    error?: string;
  }): MentalModelsClient & { listMentalModels: ReturnType<typeof mock> } {
    return {
      listMentalModels: mock(() => Promise.resolve(result)),
    } as unknown as MentalModelsClient & { listMentalModels: ReturnType<typeof mock> };
  }

  it("returns null when the client call fails", async () => {
    const client = makeClient({ success: false, error: "boom" });
    expect(await loadMentalModelsBlock(client, undefined)).toBeNull();
  });

  it("returns null when no models have content", async () => {
    const client = makeClient({ success: true, items: [makeModel({ content: null })] });
    expect(await loadMentalModelsBlock(client, undefined)).toBeNull();
  });

  it("returns the formatted block on success", async () => {
    const client = makeClient({ success: true, items: [makeModel()] });
    const block = await loadMentalModelsBlock(client, undefined);
    expect(block).not.toBeNull();
    expect(block?.count).toBe(1);
    expect(block?.content).toContain("<hindsight_mental_models>");
  });

  it("passes tag filters through to the client", async () => {
    const client = makeClient({ success: true, items: [] });
    await loadMentalModelsBlock(client, undefined, { tags: ["project:myapp"] });
    expect(client.listMentalModels).toHaveBeenCalledWith(
      { tags: ["project:myapp"] },
      expect.anything()
    );
  });

  it("returns null when the client throws", async () => {
    const client = {
      listMentalModels: mock(() => Promise.reject(new Error("network down"))),
    } as unknown as MentalModelsClient;
    expect(await loadMentalModelsBlock(client, undefined)).toBeNull();
  });
});

// ============================================
// HindsightClientWrapper mental model methods
// ============================================

describe("HindsightClientWrapper mental models", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockSdkMethods(client: HindsightClientWrapper) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = (client as any).client;
    return sdk;
  }

  it("listMentalModels returns items on success", async () => {
    const client = new HindsightClientWrapper(testConfig);
    const sdk = mockSdkMethods(client);
    const items = [makeModel()];
    const orig = sdk.listMentalModels.bind(sdk);
    sdk.listMentalModels = mock(() => Promise.resolve({ items }));

    const result = await client.listMentalModels();

    expect(result.success).toBe(true);
    expect(result.items).toEqual(items);
    sdk.listMentalModels = orig;
  });

  it("listMentalModels returns error on failure", async () => {
    const client = new HindsightClientWrapper(testConfig);
    const sdk = mockSdkMethods(client);
    const orig = sdk.listMentalModels.bind(sdk);
    sdk.listMentalModels = mock(() => Promise.reject(new Error("list failed")));

    const result = await client.listMentalModels();

    expect(result.success).toBe(false);
    expect(result.error).toContain("list failed");
    sdk.listMentalModels = orig;
  });

  it("listMentalModels times out per mentalModelsTimeoutMs", async () => {
    const client = new HindsightClientWrapper({ ...testConfig, mentalModelsTimeoutMs: 50 });
    const sdk = mockSdkMethods(client);
    const orig = sdk.listMentalModels.bind(sdk);
    sdk.listMentalModels = mock(() => new Promise(() => {}));

    const result = await client.listMentalModels();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Operation timed out after 50ms");
    sdk.listMentalModels = orig;
  });

  it("getMentalModel returns the model on success", async () => {
    const client = new HindsightClientWrapper(testConfig);
    const sdk = mockSdkMethods(client);
    const model = makeModel();
    const orig = sdk.getMentalModel.bind(sdk);
    sdk.getMentalModel = mock(() => Promise.resolve(model));

    const result = await client.getMentalModel("user-preferences");

    expect(result.success).toBe(true);
    expect(result.model?.id).toBe("user-preferences");
    sdk.getMentalModel = orig;
  });

  it("refreshMentalModel returns the operation on success", async () => {
    const client = new HindsightClientWrapper(testConfig);
    const sdk = mockSdkMethods(client);
    const orig = sdk.refreshMentalModel.bind(sdk);
    sdk.refreshMentalModel = mock(() =>
      Promise.resolve({ operation_id: "op-1", status: "pending" })
    );

    const result = await client.refreshMentalModel("user-preferences");

    expect(result.success).toBe(true);
    expect(result.operation?.operation_id).toBe("op-1");
    sdk.refreshMentalModel = orig;
  });
});

// ============================================
// /hindsight models subcommand
// ============================================

describe("models subcommand", () => {
  let lastNotification: { message: string; type: string } | null = null;

  function makeClient(
    impl: Record<string, (...args: unknown[]) => Promise<unknown>>
  ): HindsightClientWrapper {
    return impl as unknown as HindsightClientWrapper;
  }

  function makeCtx() {
    return {
      sessionManager: { getSessionId: () => "test-session-123" },
      ui: {
        notify: mock((message: string, type: string) => {
          lastNotification = { message, type };
        }),
      },
      signal: undefined,
      cwd: "/test",
    } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
  }

  beforeEach(() => {
    lastNotification = null;
  });

  it("notifies when the client is not configured", async () => {
    const sub = createMentalModelsSubcommand(null, testConfig);
    await sub.handler("", makeCtx());
    expect(lastNotification?.message).toContain("not configured");
  });

  it("lists models with id, name, and refresh time", async () => {
    const client = makeClient({
      listMentalModels: () => Promise.resolve({ success: true, items: [makeModel()] }),
    });
    const sub = createMentalModelsSubcommand(client, testConfig);
    await sub.handler("", makeCtx());
    expect(lastNotification?.message).toContain("user-preferences");
    expect(lastNotification?.message).toContain("User Preferences");
    expect(lastNotification?.message).toContain("2026-10-06");
  });

  it("notifies when the bank has no mental models", async () => {
    const client = makeClient({
      listMentalModels: () => Promise.resolve({ success: true, items: [] }),
    });
    const sub = createMentalModelsSubcommand(client, testConfig);
    await sub.handler("", makeCtx());
    expect(lastNotification?.message).toContain("No mental models");
  });

  it("reports list failures", async () => {
    const client = makeClient({
      listMentalModels: () => Promise.resolve({ success: false, error: "server down" }),
    });
    const sub = createMentalModelsSubcommand(client, testConfig);
    await sub.handler("", makeCtx());
    expect(lastNotification?.message).toContain("failed to list mental models");
  });

  it("rejects unknown arguments with usage", async () => {
    const client = makeClient({
      listMentalModels: () => Promise.resolve({ success: true, items: [] }),
    });
    const sub = createMentalModelsSubcommand(client, testConfig);
    await sub.handler("bogus", makeCtx());
    expect(lastNotification?.message).toContain("Usage: models [refresh <id>]");
  });

  it("refresh triggers a refresh and reports the operation", async () => {
    const refreshMentalModel = mock(() =>
      Promise.resolve({ success: true, operation: { operation_id: "op-9", status: "pending" } })
    );
    const client = makeClient({ refreshMentalModel });
    const sub = createMentalModelsSubcommand(client, testConfig);
    await sub.handler("refresh user-preferences", makeCtx());
    expect(refreshMentalModel).toHaveBeenCalledWith("user-preferences");
    expect(lastNotification?.message).toContain("Refresh started");
    expect(lastNotification?.message).toContain("op-9");
  });

  it("refresh without an id lists models with a usage hint", async () => {
    const client = makeClient({
      listMentalModels: () => Promise.resolve({ success: true, items: [makeModel()] }),
    });
    const sub = createMentalModelsSubcommand(client, testConfig);
    await sub.handler("refresh", makeCtx());
    expect(lastNotification?.message).toContain("Usage: /hindsight models refresh <id>");
  });

  it("refresh reports failures", async () => {
    const client = makeClient({
      refreshMentalModel: () => Promise.resolve({ success: false, error: "not found" }),
    });
    const sub = createMentalModelsSubcommand(client, testConfig);
    await sub.handler("refresh nope", makeCtx());
    expect(lastNotification?.message).toContain("failed to refresh mental model");
  });
});
