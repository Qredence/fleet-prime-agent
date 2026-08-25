#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tsgo = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsgo.cmd" : "tsgo");

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
}

// CI validates the checked-in generated catalog. The regular root build
// intentionally refreshes it from live provider catalogs, which is not a
// reproducible CI input and has previously removed models mid-build.
run(npm, ["run", "build"], join(root, "packages/tui"));
run(tsgo, ["-p", "tsconfig.build.json"], join(root, "packages/ai"));
run(npm, ["run", "build"], join(root, "packages/agent"));
run(npm, ["run", "build"], join(root, "packages/coding-agent"));
