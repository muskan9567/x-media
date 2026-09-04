import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracker/service", () => ({
  updateTweetWorkflow: vi.fn(),
}));

import { ApiError } from "@/lib/api-response";
import { updateTweetWorkflow } from "@/lib/tracker/service";

import { PATCH } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/tweets/tweet-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = {
  params: Promise.resolve({ id: "tweet-1" }),
} as RouteContext<"/api/tweets/[id]">;

afterEach(() => {
  vi.mocked(updateTweetWorkflow).mockReset();
});

describe("PATCH /api/tweets/:id", () => {
  it("updates the requested tweet with a supported workflow status", async () => {
    const updatedTweet = { id: "tweet-1", workflowStatus: "saved" };
    vi.mocked(updateTweetWorkflow).mockResolvedValue(updatedTweet as never);

    const response = await PATCH(request({ workflowStatus: "saved" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(updatedTweet);
    expect(updateTweetWorkflow).toHaveBeenCalledWith("tweet-1", {
      workflowStatus: "saved",
    });
  });

  it("rejects an unsupported workflow status before updating", async () => {
    const response = await PATCH(
      request({ workflowStatus: "queued" }),
      context,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request.",
    });
    expect(updateTweetWorkflow).not.toHaveBeenCalled();
  });

  it("preserves intentional service errors", async () => {
    vi.mocked(updateTweetWorkflow).mockRejectedValue(
      new ApiError("Tweet not found.", 404),
    );

    const response = await PATCH(
      request({ workflowStatus: "dismissed" }),
      context,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Tweet not found.",
    });
  });
});
