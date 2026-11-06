#!/usr/bin/env node
/**
 * The control CLI of the dsh host (T010, research.md R1): bin
 * `specstride-host-dsh`. Thin arg parsing and exit-code plumbing only — the
 * bodies of `install`/`uninstall` land with T026–T027, `doctor` with T021,
 * `eval` with T031. A subcommand that is not yet wired prints ONE line naming
 * its task and exits non-zero. An unknown subcommand refuses with one line.
 */

const WIRED = new Set(["doctor"]);

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
  // install/uninstall/eval are wired by their own tasks (T026, T027, T031).
  console.error(`specstride-host-dsh ${subcommand}: no handler registered`);
  return 1;
}

if (process.argv[1] === new URL(import.meta.url, "file://").pathname) {
  process.exit(await dispatch(process.argv));
}
