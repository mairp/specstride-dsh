#!/usr/bin/env node
/**
 * The control CLI of the dsh host (T010, research.md R1): bin
 * `specstride-host-dsh`. Thin arg parsing and exit-code plumbing only —
 * `install`/`uninstall` run the installer/uninstaller of `src/installer.ts`
 * (T026–T027), `doctor` the runner of `src/doctor.ts` (T021), `eval` the
 * person-started paid lane of `src/evals/paid-lane.ts` (T031) — a mode that
 * spends refuses before any call without a model (`RunRefusedError`). An
 * unknown subcommand refuses with one line.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WIRED = new Set(["install", "uninstall", "doctor", "eval"]);

const TASK_OF = {
  install: "T026",
  uninstall: "T027",
  doctor: "T021",
  eval: "T031",
};

export async function dispatch(argv) {
  const args = argv.slice(2);
  const [subcommand] = args;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    console.log(
      "usage: specstride-host-dsh <install|uninstall|doctor|eval> [args]",
    );
    return 2;
  }
  if (!(subcommand in TASK_OF)) {
    console.error(
      `specstride-host-dsh: unknown subcommand "${subcommand}" (known: install, uninstall, doctor, eval)`,
    );
    return 2;
  }
  if (!WIRED.has(subcommand)) {
    console.error(
      `specstride-host-dsh ${subcommand}: not wired yet — its body lands with ${TASK_OF[subcommand]} of specs/120-host-dsh`,
    );
    return 3;
  }
  if (subcommand === "doctor") {
    const { doctorMain } = await import("../src/doctor.ts");
    return doctorMain(args.slice(1));
  }
  if (subcommand === "install") {
    const { installMain } = await import("../src/installer.ts");
    return installMain(process.env, args.slice(1));
  }
  if (subcommand === "uninstall") {
    const { uninstallMain } = await import("../src/installer.ts");
    return uninstallMain(process.env, args.slice(1));
  }
  if (subcommand === "eval") {
    const { evalMain } = await import("../src/evals/paid-lane.ts");
    return evalMain(args.slice(1));
  }
  console.error(`specstride-host-dsh ${subcommand}: no handler registered`);
  return 1;
}

// Run when this file is the entry point, also through a symlink: npm links a
// package's bins (`npm install -g`, `npx`, node_modules/.bin), so argv[1] is the
// link's path, never this file's. Compare real paths.
function isEntryPoint() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exit(await dispatch(process.argv));
}
