import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolvePageActions } from "./page-actions";
import * as enrollButtons from "../../versioning/enroll-buttons";
import * as formState from "../../form-state";
import * as settings from "../../settings";
import * as componentRegistry from "../../component-registry";

vi.mock("../../versioning/enroll-buttons");
vi.mock("../../form-state");
vi.mock("../../settings");
vi.mock("../../component-registry");

describe("resolvePageActions", () => {
  const mockVm = {
    getLatestRun: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts checkout buttons across live and running test versions", () => {
    vi.mocked(enrollButtons.trackedEnrollButtonsByVersion).mockReturnValue({
      default: 2,
      variant_a: 3,
    });
    vi.mocked(formState.getAllFormEntries).mockReturnValue([]);
    vi.mocked(settings.getLeadConversionEventNames).mockReturnValue([]);
    vi.mocked(componentRegistry.loadAllMicroEvents).mockReturnValue({});
    
    mockVm.getLatestRun.mockReturnValue({
      ended_at: null,
      versions: ["variant_a"],
    });

    const actions = resolvePageActions({
      contentFolder: "site_test",
      contentRoot: "site_test",
      entry: { content_type: "program", slug: "test", locale: "en" },
      locales: ["en"],
      vm: mockVm,
    });

    expect(actions.checkout_buttons).toBe(5);
  });

  it("only counts buttons from live version when no test is running", () => {
    vi.mocked(enrollButtons.trackedEnrollButtonsByVersion).mockReturnValue({
      default: 2,
    });
    vi.mocked(formState.getAllFormEntries).mockReturnValue([]);
    vi.mocked(settings.getLeadConversionEventNames).mockReturnValue([]);
    vi.mocked(componentRegistry.loadAllMicroEvents).mockReturnValue({});
    
    mockVm.getLatestRun.mockReturnValue(null);

    const actions = resolvePageActions({
      contentFolder: "site_test",
      contentRoot: "site_test",
      entry: { content_type: "program", slug: "test", locale: "en" },
      locales: ["en"],
      vm: mockVm,
    });

    expect(actions.checkout_buttons).toBe(2);
  });

  it("counts lead forms matching entry and lead conversion events", () => {
    vi.mocked(enrollButtons.trackedEnrollButtonsByVersion).mockReturnValue({});
    vi.mocked(settings.getLeadConversionEventNames).mockReturnValue(["student_application", "request_more_info"]);
    vi.mocked(componentRegistry.loadAllMicroEvents).mockReturnValue({});
    vi.mocked(formState.getAllFormEntries).mockReturnValue([
      {
        file: "site_test/program/test/en.yml",
        content_type: "program",
        slug: "test",
        locale: "en",
        section_id: "1",
        section_type: "lead_form",
        conversion_name: "student_application",
      },
      {
        file: "site_test/program/test/es.yml",
        content_type: "program",
        slug: "test",
        locale: "es",
        section_id: "1",
        section_type: "lead_form",
        conversion_name: "student_application",
      },
      {
        file: "site_test/program/other/en.yml",
        content_type: "program",
        slug: "other",
        locale: "en",
        section_id: "1",
        section_type: "lead_form",
        conversion_name: "student_application",
      },
      {
        file: "site_test/program/test/en.yml",
        content_type: "program",
        slug: "test",
        locale: "en",
        section_id: "2",
        section_type: "lead_form",
        conversion_name: "not_a_lead_event",
      },
    ] as any);
    
    mockVm.getLatestRun.mockReturnValue(null);

    const actions = resolvePageActions({
      contentFolder: "site_test",
      contentRoot: "site_test",
      entry: { content_type: "program", slug: "test", locale: "en" },
      locales: ["en", "es"],
      vm: mockVm,
    });

    expect(actions.lead_forms).toBe(2);
  });

  it("detects broken micro events files", () => {
    vi.mocked(enrollButtons.trackedEnrollButtonsByVersion).mockReturnValue({});
    vi.mocked(formState.getAllFormEntries).mockReturnValue([]);
    vi.mocked(settings.getLeadConversionEventNames).mockReturnValue([]);
    vi.mocked(componentRegistry.loadAllMicroEvents).mockReturnValue({
      hero: { status: "ok", map: [] },
      features: { status: "error", error: "Parse error" },
    });
    
    mockVm.getLatestRun.mockReturnValue(null);

    const actions = resolvePageActions({
      contentFolder: "site_test",
      contentRoot: "site_test",
      entry: { content_type: "program", slug: "test", locale: "en" },
      locales: ["en"],
      vm: mockVm,
    });

    expect(actions.micro.broken).toBe(true);
  });

  it("returns zero counts on errors", () => {
    vi.mocked(enrollButtons.trackedEnrollButtonsByVersion).mockImplementation(() => {
      throw new Error("Test error");
    });
    vi.mocked(formState.getAllFormEntries).mockReturnValue([]);
    vi.mocked(settings.getLeadConversionEventNames).mockReturnValue([]);
    vi.mocked(componentRegistry.loadAllMicroEvents).mockReturnValue({});
    
    mockVm.getLatestRun.mockReturnValue(null);

    const actions = resolvePageActions({
      contentFolder: "site_test",
      contentRoot: "site_test",
      entry: { content_type: "program", slug: "test", locale: "en" },
      locales: ["en"],
      vm: mockVm,
    });

    expect(actions.checkout_buttons).toBe(0);
  });
});
