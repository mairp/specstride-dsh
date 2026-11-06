/**
 * Shared fixture of the US1 run contract tests (T011–T013): the rendered
 * `specstride-run` body, read from the BUILT artifact so the tests observe
 * the shipped state (`skills/specstride-run/SKILL.md`), built exactly as
 * the gate builds it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let cached: string | null = null;

/** The composed body of `specstride-run`, as the build shipped it. */
export function builtRunBody(): string {
  if (cached === null) {
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", join("scripts", "build.ts")],
      { cwd: ROOT, stdio: "pipe" },
    );
    cached = readFileSync(join(ROOT, "skills", "specstride-run", "SKILL.md"), "utf8");
  }
  return cached;
}

export { ROOT };
