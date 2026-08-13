import type { HostToCanvasMessage } from "@posthog/core/canvas/freeformSchemas";
import { describe, expect, it, vi } from "vitest";
import { createCanvasHostMessageRouter } from "./canvasHostMessageRouter";

describe("createCanvasHostMessageRouter", () => {
  const actionMessage = {
    channel: "posthog-canvas" as const,
    type: "report-action" as const,
    id: "action-1",
    action: "create-pull-request" as const,
  };

  it("runs a report action only after a user interaction", async () => {
    const post = vi.fn<(message: HostToCanvasMessage) => void>();
    const onReportAction = vi.fn().mockResolvedValue(undefined);
    const route = createCanvasHostMessageRouter({
      post,
      callbacks: () => ({ onDataRequest: vi.fn(), onReportAction }),
      hasUserActivation: () => false,
      openExternal: vi.fn(),
    });

    await route(actionMessage);

    expect(onReportAction).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "report-action-response",
        ok: false,
      }),
    );
  });

  it("returns the report action result to the canvas", async () => {
    const post = vi.fn<(message: HostToCanvasMessage) => void>();
    const onReportAction = vi.fn().mockResolvedValue(undefined);
    const route = createCanvasHostMessageRouter({
      post,
      callbacks: () => ({ onDataRequest: vi.fn(), onReportAction }),
      hasUserActivation: () => true,
      openExternal: vi.fn(),
    });

    await route(actionMessage);

    expect(onReportAction).toHaveBeenCalledWith("create-pull-request");
    expect(post).toHaveBeenCalledWith({
      channel: "posthog-canvas",
      type: "report-action-response",
      id: "action-1",
      ok: true,
    });
  });
});
