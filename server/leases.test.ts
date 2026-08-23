import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { clearSiteSqliteCacheForTests } from "./db";
import { resetPipelineDbCache } from "./pipeline-db/runner";
import {
  acquireLease,
  getActiveLease,
  releaseLease,
  verifyLeaseToken,
  bindingLeaseResource,
  listActiveLeases,
} from "./leases";

const TEST_SITE = "site_test-leases";

describe("leases", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = path.join("data", TEST_SITE.replace(/\//g, "-"), "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = path.join("data", TEST_SITE.replace(/\//g, "-"), "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("acquires and releases with fencing token", () => {
    const resource = bindingLeaseResource("g1", "en");
    const a = acquireLease(TEST_SITE, resource, "holder-a");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(verifyLeaseToken(TEST_SITE, resource, a.lease.token)).toBe(true);
    releaseLease(TEST_SITE, resource, "holder-a", a.lease.token);
    expect(getActiveLease(TEST_SITE, resource)).toBeNull();
  });

  it("rejects conflicting holder", () => {
    const resource = bindingLeaseResource("g2", "en");
    acquireLease(TEST_SITE, resource, "holder-a");
    const b = acquireLease(TEST_SITE, resource, "holder-b");
    expect(b.ok).toBe(false);
  });

  it("renews same holder", () => {
    const resource = bindingLeaseResource("g3", "en");
    const a1 = acquireLease(TEST_SITE, resource, "holder-a");
    const a2 = acquireLease(TEST_SITE, resource, "holder-a");
    expect(a1.ok).toBe(true);
    expect(a2.ok).toBe(true);
    if (a1.ok && a2.ok) {
      expect(a2.lease.token).toBe(a1.lease.token);
    }
  });

  it("lists only active leases", () => {
    const resource = bindingLeaseResource("g-active", "en");
    const acquired = acquireLease(TEST_SITE, resource, "holder-a", 60_000);
    expect(acquired.ok).toBe(true);
    const leases = listActiveLeases(TEST_SITE);
    expect(leases.some((l) => l.resource === resource)).toBe(true);
    if (acquired.ok) {
      releaseLease(TEST_SITE, resource, "holder-a", acquired.lease.token);
    }
    expect(listActiveLeases(TEST_SITE).some((l) => l.resource === resource)).toBe(false);
  });
});
