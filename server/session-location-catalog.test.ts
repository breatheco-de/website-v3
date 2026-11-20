import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  databaseHasGeoFields,
  listLocalDatabaseSlugs,
  listLocationDatabaseGeoErrors,
  listLocationGeoOkDatabases,
  loadLocationsFromDatabase,
  loadSessionLocationCatalog,
  SESSION_LOCATION_GEO_ERROR,
} from "./session-location-catalog";
import { resetSettings, updateSessionSettings } from "./settings";

function writeSite(root: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
}

describe("session location catalog", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) {
      resetSettings(d);
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function tmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "session-loc-"));
    tmpDirs.push(d);
    return d;
  }

  it("returns empty when session database is None", () => {
    const root = tmp();
    writeSite(root, {
      "settings.yml": "i18n: {}\n",
      "db/locations/config.yml":
        "name: Locations\nsource:\n  type: local\n  local:\n    filename: locations.yml\n",
      "db/locations/locations.yml":
        "- slug: miami-usa\n  name: Miami\n  city: Miami\n  country: United States\n  country_code: US\n  latitude: 25.76\n  longitude: -80.19\n  region: usa-canada\n  default_language: en\n  timezone: America/New_York\n  visibility: listed\n",
    });
    expect(loadSessionLocationCatalog(root)).toEqual([]);
    expect(loadLocationsFromDatabase("locations", root)).toHaveLength(1);
  });

  it("loads catalog when session.location.database is set", () => {
    const root = tmp();
    writeSite(root, {
      "settings.yml": "i18n: {}\n",
      "db/locations/config.yml":
        "name: Locations\nsource:\n  type: local\n  local:\n    filename: locations.yml\n",
      "db/locations/locations.yml":
        "- slug: miami-usa\n  name: Miami\n  city: Miami\n  country: United States\n  country_code: US\n  latitude: 25.76\n  longitude: -80.19\n  region: usa-canada\n  default_language: en\n  timezone: America/New_York\n  visibility: listed\n",
    });
    updateSessionSettings({ location: { database: "locations", fill_from_ip: true } }, root);
    const list = loadSessionLocationCatalog(root);
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe("miami-usa");
    expect(list[0].latitude).toBe(25.76);
  });

  it("skips rows missing lat/lon", () => {
    const root = tmp();
    writeSite(root, {
      "settings.yml": "session:\n  location:\n    database: locations\n    fill_from_ip: true\n",
      "db/locations/config.yml":
        "name: Locations\nsource:\n  type: local\n  local:\n    filename: locations.yml\n",
      "db/locations/locations.yml":
        "- slug: no-pin\n  name: No Pin\n  city: X\n  country: Y\n  country_code: US\n  region: usa-canada\n  default_language: en\n  timezone: UTC\n  visibility: listed\n",
    });
    expect(loadSessionLocationCatalog(root)).toEqual([]);
  });

  it("lists local database slugs", () => {
    const root = tmp();
    writeSite(root, {
      "db/locations/config.yml": "name: L\nsource:\n  type: local\n  local:\n    filename: locations.yml\n",
      "db/remote/config.yml": "name: R\nsource:\n  type: api\n  api:\n    url: https://example.com\n",
    });
    expect(listLocalDatabaseSlugs(root)).toEqual(["locations"]);
  });

  it("loads rows that use short lat/lon field names", () => {
    const root = tmp();
    writeSite(root, {
      "db/locations/config.yml":
        "name: L\nsource:\n  type: local\n  local:\n    filename: locations.yml\neditor:\n  lat:\n    type: number\n  lon:\n    type: number\n",
      "db/locations/locations.yml":
        "- slug: short-pin\n  name: Short\n  lat: 10.5\n  lon: -66.9\n  region: latam\n  default_language: es\n  visibility: listed\n",
    });
    const list = loadLocationsFromDatabase("locations", root);
    expect(list).toHaveLength(1);
    expect(list[0].latitude).toBe(10.5);
    expect(list[0].longitude).toBe(-66.9);
    expect(databaseHasGeoFields("locations", root)).toBe(true);
  });

  it("flags databases missing lat/lon as unusable for session location", () => {
    const root = tmp();
    writeSite(root, {
      "db/locations/config.yml":
        "name: L\nsource:\n  type: local\n  local:\n    filename: locations.yml\neditor:\n  latitude:\n    type: number\n  longitude:\n    type: number\n",
      "db/faqs/config.yml":
        "name: FAQ\nsource:\n  type: local\n  local:\n    filename: faqs.yml\neditor:\n  question:\n    type: text\n  answer:\n    type: text\n",
      "db/faqs/faqs.yml": "- question: Q\n  answer: A\n",
    });
    expect(databaseHasGeoFields("locations", root)).toBe(true);
    expect(databaseHasGeoFields("faqs", root)).toBe(false);
    expect(listLocationGeoOkDatabases(root)).toEqual(["locations"]);
    expect(listLocationDatabaseGeoErrors(root)).toEqual({
      faqs: SESSION_LOCATION_GEO_ERROR,
    });
  });
});
