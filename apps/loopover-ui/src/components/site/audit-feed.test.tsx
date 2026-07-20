import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/request", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("@/lib/api/origin", () => ({ getApiOrigin: () => "https://api.test" }));

import {
  appendSkippedPrAuditPage,
  buildSkippedPrAuditPath,
  formatSkipReason,
  normalizeSinceInput,
  normalizeSkippedPrAuditExport,
  pullRequestHref,
} from "@/components/site/audit-feed-model";
import { AuditFeed } from "@/components/site/audit-feed";

const SAMPLE: {
  generatedAt: string;
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  filters: { repoFullName: null; reason: null; since: null };
  items: Array<{
    repoFullName: string;
    pullNumber: number;
    reason: string;
    timestamp: string;
    remediation: string;
  }>;
} = {
  generatedAt: "2026-05-28T00:00:05.000Z",
  limit: 50,
  offset: 0,
  total: 1,
  hasMore: false,
  filters: { repoFullName: null, reason: null, since: null },
  items: [
    {
      repoFullName: "repo-owner/owned-repo",
      pullNumber: 6,
      reason: "surface_off",
      timestamp: "2026-05-28T00:00:04.000Z",
      remediation: "Enable a PR public surface in repository settings.",
    },
  ],
};

describe("audit feed helpers", () => {
  it("builds query paths for skipped PR audit filters including offset (#7438)", () => {
    expect(buildSkippedPrAuditPath({ limit: 25 })).toBe(
      "/v1/app/skipped-pr-audit?limit=25&offset=0",
    );
    expect(
      buildSkippedPrAuditPath({
        limit: 50,
        offset: 50,
        repoFullName: "repo-owner/owned-repo",
        reason: "bot_author",
        since: "2026-05-28T00:00:00.000Z",
      }),
    ).toBe(
      "/v1/app/skipped-pr-audit?limit=50&offset=50&repoFullName=repo-owner%2Fowned-repo&reason=bot_author&since=2026-05-28T00%3A00%3A00.000Z",
    );
    expect(buildSkippedPrAuditPath({ limit: 10, offset: -3 })).toBe(
      "/v1/app/skipped-pr-audit?limit=10&offset=0",
    );
  });

  it("formats skip reasons and pull request links", () => {
    expect(formatSkipReason("surface_off")).toBe("Surface off");
    expect(formatSkipReason("legacy_skip_reason")).toBe("legacy skip reason");
    expect(pullRequestHref("repo-owner/owned-repo", 6)).toBe(
      "https://github.com/repo-owner/owned-repo/pull/6",
    );
  });

  it("normalizes since input without throwing on invalid dates", () => {
    expect(normalizeSinceInput("")).toBe("");
    expect(normalizeSinceInput("   ")).toBe("");
    expect(normalizeSinceInput("not-a-date")).toBe("");
    expect(normalizeSinceInput("2026-05-28T00:00:00.000Z")).toBe("2026-05-28T00:00:00.000Z");
    expect(() => normalizeSinceInput("definitely-not-a-date")).not.toThrow();
  });

  it("normalizes skipped-pr audit exports and rejects malformed payloads", () => {
    expect(normalizeSkippedPrAuditExport(SAMPLE)).toEqual(SAMPLE);
    expect(normalizeSkippedPrAuditExport({ ...SAMPLE, items: [] })).toMatchObject({ items: [] });
    expect(normalizeSkippedPrAuditExport(null)).toBeNull();
    expect(normalizeSkippedPrAuditExport({ generatedAt: "2026-05-28T00:00:05.000Z" })).toBeNull();
    expect(
      normalizeSkippedPrAuditExport({
        generatedAt: SAMPLE.generatedAt,
        hasMore: true,
        items: SAMPLE.items,
      }),
    ).toMatchObject({ offset: 0, total: 1, limit: 1 });
    expect(
      normalizeSkippedPrAuditExport({
        ...SAMPLE,
        items: [
          {
            repoFullName: "x/y",
            pullNumber: 1,
            reason: "bot_author",
            timestamp: "t",
            remediation: "r",
          },
          null,
          "bad",
        ],
      }),
    ).toMatchObject({ items: [{ repoFullName: "x/y", pullNumber: 1 }] });
  });

  it("REGRESSION (#7438): appends the next offset page instead of replacing already-visible rows", () => {
    const page1 = {
      ...SAMPLE,
      hasMore: true,
      total: 2,
      items: [SAMPLE.items[0]!],
    };
    const page2 = {
      ...SAMPLE,
      offset: 50,
      hasMore: false,
      total: 2,
      items: [
        {
          repoFullName: "repo-owner/owned-repo",
          pullNumber: 5,
          reason: "bot_author",
          timestamp: "2026-05-28T00:00:03.000Z",
          remediation: "Ignore bot authors in repository settings.",
        },
      ],
    };
    expect(appendSkippedPrAuditPage(null, page1)).toEqual(page1);
    expect(appendSkippedPrAuditPage(page1, { ...page1, offset: 0, items: [] }).items).toEqual([]);
    expect(appendSkippedPrAuditPage(page1, page2).items.map((item) => item.pullNumber)).toEqual([
      6, 5,
    ]);
  });
});

describe("AuditFeed", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, data: SAMPLE });
  });

  it("renders populated audit rows from the skipped-pr-audit API", async () => {
    render(<AuditFeed />);
    expect(await screen.findByText("repo-owner/owned-repo")).toBeTruthy();
    expect(screen.getByText("Enable a PR public surface in repository settings.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /#6/i }).getAttribute("href")).toBe(
      "https://github.com/repo-owner/owned-repo/pull/6",
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "https://api.test/v1/app/skipped-pr-audit?limit=50&offset=0",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("wraps the audit table in a keyboard-focusable, labelled scroll region with a caption and column-scoped headers (#794 a11y pattern)", async () => {
    render(<AuditFeed />);
    await screen.findByText("repo-owner/owned-repo");
    const region = screen.getByRole("region", { name: "Skipped PR audit" });
    // A bare overflow-x-auto div is not a tab stop; TableScroll makes it one (WCAG 2.1.1).
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain("overflow-x-auto");
    const table = screen.getByRole("table", {
      name: "Skipped pull requests with the time, repository, pull request, skip reason, and remediation for each.",
    });
    expect(within(table).getByRole("columnheader", { name: "Time" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "Remediation" })).toBeTruthy();
  });

  it("shows an empty state when the audit export has no items", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { ...SAMPLE, items: [], total: 0 } });
    render(<AuditFeed />);
    expect(await screen.findByText("No skipped PR events")).toBeTruthy();
  });

  it("shows an error state when the audit request fails", async () => {
    apiFetch.mockResolvedValue({ ok: false, message: "insufficient_role" });
    render(<AuditFeed />);
    expect(await screen.findByText("Couldn't load skip audit")).toBeTruthy();
    expect(screen.getByText("insufficient_role")).toBeTruthy();
  });

  it("applies repository filters to subsequent audit requests", async () => {
    render(<AuditFeed />);
    await screen.findByText("repo-owner/owned-repo");
    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ ok: true, data: SAMPLE });

    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "repo-owner/owned-repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("repoFullName=repo-owner%2Fowned-repo"),
        expect.any(Object),
      ),
    );
    expect(apiFetch.mock.calls.some(([url]) => String(url).includes("offset=0"))).toBe(true);
  });

  it("ignores invalid since values when applying filters", async () => {
    render(<AuditFeed />);
    await screen.findByText("repo-owner/owned-repo");
    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ ok: true, data: SAMPLE });

    fireEvent.change(screen.getByLabelText(/^since$/i), {
      target: { value: "definitely-not-a-date" },
    });
    fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
      target: { value: "repo-owner/owned-repo" },
    });
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: /apply filters/i })),
    ).not.toThrow();

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("repoFullName=repo-owner%2Fowned-repo"),
        expect.any(Object),
      ),
    );
    expect(apiFetch.mock.calls.some(([url]) => String(url).includes("since="))).toBe(false);
  });

  it("shows a role error when the feed is disabled", async () => {
    render(<AuditFeed enabled={false} />);
    expect(await screen.findByText("Couldn't load skip audit")).toBeTruthy();
    expect(screen.getByText("This audit feed is unavailable for your current role.")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("REGRESSION (#7438): Load more advances offset and appends rows instead of growing limit", async () => {
    const firstPage = {
      ...SAMPLE,
      hasMore: true,
      total: 2,
      items: [SAMPLE.items[0]!],
    };
    const secondPage = {
      ...SAMPLE,
      offset: 50,
      hasMore: false,
      total: 2,
      items: [
        {
          repoFullName: "repo-owner/owned-repo",
          pullNumber: 5,
          reason: "bot_author",
          timestamp: "2026-05-28T00:00:03.000Z",
          remediation: "Ignore bot authors in repository settings.",
        },
      ],
    };
    apiFetch.mockResolvedValueOnce({ ok: true, data: firstPage });
    render(<AuditFeed />);
    expect(await screen.findByText("#6")).toBeTruthy();
    apiFetch.mockClear();
    apiFetch.mockResolvedValueOnce({ ok: true, data: secondPage });

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "https://api.test/v1/app/skipped-pr-audit?limit=50&offset=50",
        expect.any(Object),
      ),
    );
    expect(await screen.findByText("#5")).toBeTruthy();
    expect(screen.getByText("#6")).toBeTruthy();
    expect(apiFetch.mock.calls.some(([url]) => String(url).includes("limit=100"))).toBe(false);
  });

  it("shows an error state when the audit response is malformed", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { generatedAt: "2026-05-28T00:00:05.000Z" } });
    render(<AuditFeed />);
    expect(await screen.findByText("Couldn't load skip audit")).toBeTruthy();
    expect(
      screen.getByText("The skipped PR audit endpoint returned an unexpected response."),
    ).toBeTruthy();
  });
});
