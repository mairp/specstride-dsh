/**
 * The dsh frontmatter stage (T006, F120-FR-002, F120-FR-003; research.md R5).
 *
 * The kit renders a SKILL.md whose frontmatter carries `name` + `description`
 * only. This stage (1) inserts the dsh invocation fields — `user-invocable:
 * true` on all three skills; `disable-model-invocation: false` on
 * `specstride-run` / `specstride-reverse`, `true` on `specstride-doctor` —
 * and (2) validates the whole file against the dsh rules: kebab-case `name`,
 * `description` of at most 500 characters, the invocation fields strict
 * booleans when present, and no field dsh does not know. Any violation FAILS
 * THE BUILD, because dsh drops a malformed skill silently.
 */

/** The fields dsh knows in a SKILL.md frontmatter. */
export const DSH_KNOWN_FRONTMATTER_FIELDS: readonly string[] = Object.freeze([
  "name",
  "description",
  "user-invocable",
  "disable-model-invocation",
  "metadata",
]);

/** The dsh catalog cap on a description (the render profile's `descriptionCap`). */
export const DSH_DESCRIPTION_CAP = 500;

/** The invocation fields the stage inserts, per logical id (F120-FR-002). */
export function dshInvocationFieldsOf(logicalId: string): readonly [
  string,
  string,
][] {
  const disableModelInvocation = logicalId === "doctor" ? "true" : "false";
  return Object.freeze([
    ["user-invocable", "true"],
    ["disable-model-invocation", disableModelInvocation],
  ]);
}

/** The lines of a frontmatter block, without the `---` fences, or `null`. */
export function frontmatterLinesOf(text: string): readonly string[] | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  return lines.slice(1, end);
}

function parseFrontmatter(
  text: string,
): readonly { field: string; rest: string }[] {
  const rows: { field: string; rest: string }[] = [];
  for (const line of frontmatterLinesOf(text) ?? []) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):(.*)$/.exec(line);
    if (match === null) {
      rows.push({ field: "", rest: line });
      continue;
    }
    rows.push({ field: match[1], rest: match[2] });
  }
  return rows;
}

/**
 * The composed SKILL.md: the kit's rendered text with the dsh invocation
 * fields inserted after the `description` row (or, when there is none, at the
 * end of the frontmatter block). Idempotent: a field already present with the
 * same value is left alone, and no field is written twice.
 */
export function insertDshFrontmatter(
  logicalId: string,
  rendered: string,
): string {
  const fields = dshInvocationFieldsOf(logicalId);
  const lines = rendered.split("\n");
  if (lines[0] !== "---") {
    throw new Error(
      `frontmatter: rendered skill for ${logicalId} has no frontmatter block`,
    );
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    throw new Error(
      `frontmatter: rendered skill for ${logicalId} has an unterminated frontmatter block`,
    );
  }
  const composed = [...lines];
  for (const [field, value] of fields) {
    const endNow = composed.indexOf("---", 1);
    let present = false;
    for (let i = 1; i < endNow; i++) {
      if (composed[i].startsWith(`${field}:`)) {
        present = true;
        if (composed[i] !== `${field}: ${value}`) {
          composed[i] = `${field}: ${value}`;
        }
        break;
      }
    }
    if (!present) {
      // Insert before the closing fence, so the kit's rows keep their order.
      composed.splice(endNow, 0, `${field}: ${value}`);
    }
  }
  return composed.join("\n");
}

/** True for a kebab-case name (lower-case words joined by single hyphens). */
export function isKebabCase(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

export type FrontmatterViolation = {
  readonly field: string;
  readonly problem: string;
};

/** The dsh-rule violations of one SKILL.md text, in file order. Empty = valid. */
export function dshFrontmatterViolations(text: string): readonly FrontmatterViolation[] {
  const violations: FrontmatterViolation[] = [];
  if (text.split("\n")[0] !== "---") {
    return [{ field: "(file)", problem: "no frontmatter block" }];
  }
  const rows = parseFrontmatter(text);
  const seen: string[] = [];
  for (const { field, rest } of rows) {
    if (field === "") {
      violations.push({ field: "(frontmatter)", problem: `malformed row: ${rest.trim()}` });
      continue;
    }
    seen.push(field);
    const value = rest.trim();
    if (!DSH_KNOWN_FRONTMATTER_FIELDS.includes(field)) {
      violations.push({
        field,
        problem: `a field dsh does not know (known: ${DSH_KNOWN_FRONTMATTER_FIELDS.join(", ")})`,
      });
      continue;
    }
    if (field === "name") {
      if (!isKebabCase(value)) {
        violations.push({ field, problem: `not kebab-case: ${value}` });
      }
      continue;
    }
    if (field === "description") {
      if (value.length > DSH_DESCRIPTION_CAP) {
        violations.push({
          field,
          problem: `${value.length} characters, over the dsh catalog cap of ${DSH_DESCRIPTION_CAP}`,
        });
      }
      continue;
    }
    if (field === "user-invocable" || field === "disable-model-invocation") {
      if (value !== "true" && value !== "false") {
        violations.push({
          field,
          problem: `not a strict boolean: "${value}" (dsh drops the skill silently)`,
        });
      }
      continue;
    }
  }
  const duplicates = seen.filter((f, i) => seen.indexOf(f) !== i);
  for (const field of new Set(duplicates)) {
    violations.push({ field, problem: "the field appears more than once" });
  }
  return violations;
}

/**
 * The validation the build runs on every composed SKILL.md: an empty list
 * passes; a non-empty list FAILS THE BUILD with the artifact named.
 */
export function assertDshFrontmatter(text: string, artifact: string): void {
  const violations = dshFrontmatterViolations(text);
  if (violations.length > 0) {
    const detail = violations
      .map((v) => `${v.field}: ${v.problem}`)
      .join("; ");
    throw new Error(
      `frontmatter violation in ${artifact} — the build fails because dsh drops a malformed skill silently (${detail})`,
    );
  }
}
