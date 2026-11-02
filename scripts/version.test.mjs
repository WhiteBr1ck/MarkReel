import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { synchronizeVersions } from "./version.mjs";

test("release version synchronizes workspace references and detects drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "markreel-version-"));
  const writeJson = async (file, data) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), JSON.stringify(data)); };
  try {
    await writeJson("package.json", { name: "markreel", version: "1.0.0", workspaces: ["apps/*"] });
    await writeJson("apps/api/package.json", { name: "@markreel/api", version: "1.0.0", dependencies: { "@markreel/mcp": "1.0.0", zod: "^3.0.0" } });
    await writeJson("apps/mcp/package.json", { name: "@markreel/mcp", version: "1.0.0" });
    await writeJson("package-lock.json", { version: "1.0.0", packages: { "": { version: "1.0.0" }, "apps/api": { version: "1.0.0" }, "apps/mcp": { version: "1.0.0" } } });
    await fs.writeFile(path.join(root, "README.md"), "https://img.shields.io/badge/version-0.9.0-4f8f5d");
    await assert.rejects(synchronizeVersions(root), /README/);
    await synchronizeVersions(root, { version: "1.0.1", write: true });
    assert.equal(await synchronizeVersions(root), "1.0.1");
    const pkg = JSON.parse(await fs.readFile(path.join(root, "apps/api/package.json"), "utf8"));
    assert.equal(pkg.dependencies["@markreel/mcp"], "1.0.1");
    assert.equal(pkg.dependencies.zod, "^3.0.0");
    const lock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8"));
    lock.packages["apps/api"].dependencies["@markreel/mcp"] = "1.0.0";
    await writeJson("package-lock.json", lock);
    await assert.rejects(synchronizeVersions(root), /package-lock.json:apps\/api:@markreel\/mcp/);
    await synchronizeVersions(root, { write: true });
    assert.equal(await synchronizeVersions(root), "1.0.1");
    pkg.version = "1.0.2";
    await writeJson("apps/api/package.json", pkg);
    await assert.rejects(synchronizeVersions(root), /apps\/api/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
