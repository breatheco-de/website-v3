import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { migrateEcommerceYmlToProduct } from "./migrate-ecommerce-yml-to-product";

describe("migrateEcommerceYmlToProduct", () => {
  it("dry-run reports rename without writing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig-product-"));
    const prog = path.join(root, "programs", "full-stack");
    fs.mkdirSync(prog, { recursive: true });
    fs.writeFileSync(path.join(prog, "_ecommerce.yml"), "purchasable: true\n");
    fs.writeFileSync(
      path.join(root, "content-types.yml"),
      "program:\n  directory: programs\n",
    );

    const result = migrateEcommerceYmlToProduct({ contentRoot: root, dryRun: true });
    expect(result.renamed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(prog, "_ecommerce.yml"))).toBe(true);
    expect(fs.existsSync(path.join(prog, "_product.yml"))).toBe(false);
  });

  it("write renames to _product.yml and is idempotent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig-product-w-"));
    const prog = path.join(root, "programs", "full-stack");
    fs.mkdirSync(prog, { recursive: true });
    fs.writeFileSync(path.join(prog, "_ecommerce.yml"), "purchasable: true\n");
    fs.writeFileSync(
      path.join(root, "content-types.yml"),
      "program:\n  directory: programs\n",
    );

    const first = migrateEcommerceYmlToProduct({ contentRoot: root, dryRun: false });
    expect(first.renamed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(prog, "_product.yml"))).toBe(true);
    expect(fs.existsSync(path.join(prog, "_ecommerce.yml"))).toBe(false);

    const second = migrateEcommerceYmlToProduct({ contentRoot: root, dryRun: false });
    expect(second.renamed).toBe(0);
  });
});
