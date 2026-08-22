import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGcs, mockAggregateImageQueuePending, mockIsImageQueueBusy } = vi.hoisted(() => ({
  mockGcs: {
    available: true,
    getBucketName: vi.fn(() => "test-bucket"),
    getStorage: vi.fn(),
    checkArchitecture: vi.fn(),
  },
  mockAggregateImageQueuePending: vi.fn(() => 0),
  mockIsImageQueueBusy: vi.fn(() => false),
}));

vi.mock("./gcs", () => ({
  gcs: mockGcs,
}));

vi.mock("./gcs-sync-inventory", () => ({
  aggregateImageQueuePending: () => mockAggregateImageQueuePending(),
}));

vi.mock("./image-queue-worker", () => ({
  isImageQueueBusy: () => mockIsImageQueueBusy(),
}));

import { runGcsConnectionTest } from "./gcs-connection-test";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.clearAllMocks();
  mockGcs.available = true;
  mockGcs.getBucketName.mockReturnValue("test-bucket");
  mockAggregateImageQueuePending.mockReturnValue(0);
  mockIsImageQueueBusy.mockReturnValue(false);
});

describe("runGcsConnectionTest", () => {
  it("returns error overall when GCS is not configured", async () => {
    mockGcs.available = false;
    mockGcs.getBucketName.mockReturnValue("");

    const result = await runGcsConnectionTest();

    expect(result.overall).toBe("error");
    expect(result.checks.find((c) => c.id === "gcs_config")?.status).toBe("error");
    expect(result.checks.find((c) => c.id === "gcs_bucket_access")?.status).toBe("skipped");
    expect(result.checks.find((c) => c.id === "gcs_architecture")?.status).toBe("skipped");
    expect(mockGcs.checkArchitecture).not.toHaveBeenCalled();
  });

  it("returns error when architecture check has checkError", async () => {
    mockGcs.getStorage.mockReturnValue({
      bucket: () => ({
        getMetadata: vi.fn().mockResolvedValue([{}]),
      }),
    });
    mockGcs.checkArchitecture.mockResolvedValue({
      migrationRequired: false,
      bucketName: "test-bucket",
      mediaSegment: "media",
      knownSitePrefixes: [],
      hasOldLayout: false,
      hasNewLayout: true,
      newLayoutSamples: {},
      checkError: "Permission denied",
    });

    const result = await runGcsConnectionTest();

    expect(result.overall).toBe("error");
    const arch = result.checks.find((c) => c.id === "gcs_architecture");
    expect(arch?.status).toBe("error");
    expect(arch?.detail).toBe("Permission denied");
  });

  it("returns warn when migration is required", async () => {
    mockGcs.getStorage.mockReturnValue({
      bucket: () => ({
        getMetadata: vi.fn().mockResolvedValue([{}]),
      }),
    });
    mockGcs.checkArchitecture.mockResolvedValue({
      migrationRequired: true,
      bucketName: "test-bucket",
      mediaSegment: "media",
      knownSitePrefixes: ["site_example"],
      hasOldLayout: true,
      hasNewLayout: false,
      newLayoutSamples: {},
      platform: {
        sitesYml: {
          label: "Site registry",
          expectedKey: "sites.yml",
          legacyKeys: [],
          foundKey: "sites.yml",
          exists: true,
          status: "found",
          updated: null,
        },
        userStore: {
          label: "User store",
          expectedKey: "user-store.json",
          legacyKeys: [],
          foundKey: null,
          exists: false,
          status: "missing",
          updated: null,
        },
        mcpAuthSamples: [],
      },
    });
    process.env.NODE_ENV = "production";

    const result = await runGcsConnectionTest();

    expect(result.overall).toBe("warn");
    expect(result.checks.find((c) => c.id === "gcs_architecture")?.status).toBe("warn");
    expect(result.checks.find((c) => c.id === "gcs_platform_artifacts")?.status).toBe("warn");
  });

  it("returns ok on happy path", async () => {
    mockGcs.getStorage.mockReturnValue({
      bucket: () => ({
        getMetadata: vi.fn().mockResolvedValue([{}]),
      }),
    });
    mockGcs.checkArchitecture.mockResolvedValue({
      migrationRequired: false,
      bucketName: "test-bucket",
      mediaSegment: "media",
      knownSitePrefixes: ["site_example"],
      hasOldLayout: false,
      hasNewLayout: true,
      newLayoutSamples: { site_example: ["site_example/media/a.jpg"] },
      platform: {
        sitesYml: {
          label: "Site registry",
          expectedKey: "sites.yml",
          legacyKeys: [],
          foundKey: "sites.yml",
          exists: true,
          status: "found",
          updated: null,
        },
        userStore: {
          label: "User store",
          expectedKey: "user-store.json",
          legacyKeys: [],
          foundKey: "user-store.json",
          exists: true,
          status: "found",
          updated: null,
        },
        mcpAuthSamples: [],
      },
    });

    const result = await runGcsConnectionTest();

    expect(result.overall).toBe("ok");
    expect(result.checks.every((c) => c.status === "ok" || c.id === "image_queue")).toBe(true);
  });
});
