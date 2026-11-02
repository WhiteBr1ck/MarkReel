import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function synchronizeVersions(root, { version, write = false } = {}) {
  const read = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
  const rootPackage = await read("package.json");
  const target = version ?? rootPackage.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target)) throw new Error("Invalid semantic version");
  const packages = new Map([["package.json", rootPackage]]);
  for (const workspace of rootPackage.workspaces) {
    if (!workspace.endsWith("/*")) throw new Error(`Unsupported workspace pattern: ${workspace}`);
    const parent = workspace.slice(0, -2);
    for (const entry of await fs.readdir(path.join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = `${parent}/${entry.name}/package.json`;
      try { packages.set(relative, await read(relative)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const names = new Set([...packages.values()].map((pkg) => pkg.name));
  const mismatches = [];
  for (const [file, pkg] of packages) {
    if (pkg.version !== target) mismatches.push(file);
    pkg.version = target;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, current] of Object.entries(pkg[field] ?? {})) {
        if (names.has(name) && /^\d+\.\d+\.\d+/.test(current)) {
          if (current !== target) mismatches.push(`${file}:${name}`);
          pkg[field][name] = target;
        }
      }
    }
  }
  const lock = await read("package-lock.json");
  if (lock.version !== target) mismatches.push("package-lock.json");
  lock.version = target;
  for (const [file, pkg] of packages) {
    const key = file === "package.json" ? "" : path.posix.dirname(file);
    if (!lock.packages[key]) throw new Error(`Workspace missing from lockfile: ${key}`);
    if (lock.packages[key].version !== target) mismatches.push(`package-lock.json:${key}`);
    lock.packages[key].version = target;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      if (pkg[field]) {
        for (const [name, value] of Object.entries(pkg[field])) {
          if (names.has(name) && lock.packages[key][field]?.[name] !== value) {
            mismatches.push(`package-lock.json:${key}:${name}`);
          }
        }
        lock.packages[key][field] = { ...pkg[field] };
      }
    }
  }
  const readmePath = path.join(root, "README.md");
  const readme = await fs.readFile(readmePath, "utf8");
  const badge = /img\.shields\.io\/badge\/version-([0-9A-Za-z.+-]+?)-4f8f5d/;
  if (!badge.test(readme)) throw new Error("README version badge not found");
  if (readme.match(badge)[1] !== target) mismatches.push("README.md");
  if (!write && mismatches.length) throw new Error(`Version mismatch (${target}): ${[...new Set(mismatches)].join(", ")}`);
  if (write) {
    for (const [file, pkg] of packages) await fs.writeFile(path.join(root, file), `${JSON.stringify(pkg, null, 2)}\n`);
    await fs.writeFile(path.join(root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    await fs.writeFile(readmePath, readme.replace(badge, `img.shields.io/badge/version-${target}-4f8f5d`));
  }
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode = "--check", version] = process.argv.slice(2);
  if (!["--check", "--sync", "--set"].includes(mode) || (mode === "--set" && !version)) {
    console.error("Usage: node scripts/version.mjs [--check | --sync | --set VERSION]");
    process.exitCode = 1;
  } else {
    synchronizeVersions(fileURLToPath(new URL("../", import.meta.url)), { version: mode === "--set" ? version : undefined, write: mode !== "--check" })
      .then((value) => console.log(`Version ${value} ${mode === "--check" ? "verified" : "synchronized"}`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
