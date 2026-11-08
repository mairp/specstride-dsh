/**
 * T024 — the client half (HF-17, F121-FR-003). One `inject("conversation.view", …)`
 * whose registration is `{ name, id, order, locale, label, inject }`; `inject(sessionId)`
 * opens the pane: one fetch per answer for now (poller), rendering through the
 * shared board tree and the React adapter, laid out through `ctx.layout` (HF-18,
 * settling check pending). The module defines no browser-global property and no
 * stored key: the DOM is confined to the pane container and its style tag.
 */
import { startPanePoller, type Pane as PollerPane } from "./poller.ts";
import { toReact } from "./react-adapter.ts";
import styles from "./generated-styles.ts";

export const VIEW_PATH = "/specstride/view";
export { POLL_MS } from "./poller.ts";

type TreeNode = { tag: string; attrs: Readonly<Record<string, string>>; text?: string; children: readonly TreeNode[] };
type Reactish = { createElement: (...args: unknown[]) => unknown };
type Timers = { setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (timer: unknown) => void };

type Ctx = {
  slots?: { inject?: (name: string, registration: unknown) => unknown };
  layout?: (descriptor: Record<string, unknown>) => unknown;
  locale?: string;
  timer?: Timers;
};

type Pane = { dispose: () => void };

function timersOf(ctx: Ctx | undefined): Timers {
  return (ctx?.timer as Timers | undefined) ?? globalThis;
}

type Docish = { querySelector?: (selector: string) => { getAttribute?: (name: string) => string | null } | null } | undefined;

/** The view token of this page load, from the index tap's meta (R5, T-41). */
function tokenOf(doc: Docish): string | null {
  const meta = doc?.querySelector?.(`meta[name="specstride-view-token"]`);
  const value = meta?.getAttribute?.("content");
  return typeof value === "string" && value !== "" ? value : null;
}

function openPane(ctx: Ctx, sessionId: string, reactOf: () => Reactish | undefined): Pane {
  const timers = timersOf(ctx);
  const pane = ctx.layout?.({
    id: "kanban",
    render: (node: TreeNode, react: Reactish) => toReact(node, react),
  }) as { mount?: () => unknown; unmount?: () => void; container?: unknown; update?: (element: unknown) => void } | undefined;
  const container = (pane?.mount?.() ?? pane?.container ?? undefined) as
    | { ownerDocument?: { createElement: (tag: string) => { setAttribute: (name: string, value: string) => void; textContent?: string; remove?: () => void; parentNode?: { removeChild: (child: unknown) => void } } }; appendChild?: (child: unknown) => void }
    | undefined;
  const doc = container?.ownerDocument;
  let style: { remove?: () => void; parentNode?: { removeChild: (child: unknown) => void } } | undefined;
  if (doc !== undefined) {
    const element = doc.createElement("style");
    element.setAttribute("data-kanban-style", "");
    element.textContent = typeof styles === "string" ? styles : "";
    container?.appendChild?.(element);
    style = element;
  }

  let latest: TreeNode | undefined;
  const show = (tree: TreeNode): void => {
    latest = tree;
    const react = reactOf();
    if (react !== undefined) pane?.update?.(toReact(tree, react));
  };
  /** The staleness line enters the pane as text, never as markup (F121-FR-012). */
  const line = (text: string): void => {
    const node = doc?.createElement("div");
    if (node === undefined) return;
    node.textContent = text;
    container?.appendChild?.(node);
  };
  const poller: PollerPane = startPanePoller(
    {
      sessionId,
      timers,
      render: (tree) => show(tree),
      stale: line,
      message: line,
      token: tokenOf(doc),
    },
    reactOf,
  );

  return {
    dispose() {
      poller.dispose();
      if (style !== undefined) {
        if (typeof style.remove === "function") style.remove();
        else style.parentNode?.removeChild(style);
      }
      pane?.unmount?.();
    },
  };
}

/** The factory the bundle returns; `require` is the host loader's (HF-16), used only for `react`. */
export default function start(ctx: Ctx & { slots: NonNullable<Ctx["slots"]> }, require?: (id: string) => unknown): { registration: Record<string, unknown>; dispose: () => void } {
  const reactOf = () => {
    try {
      const react = typeof require === "function" ? require("react") : undefined;
      return react as Reactish | undefined;
    } catch {
      return undefined;
    }
  };
  const locale = typeof ctx.locale === "string" ? ctx.locale : "en";
  const registration: Record<string, unknown> = {
    name: "conversation.view",
    id: "kanban",
    order: 20,
    locale,
    label: () => "Kanban",
    inject: (sessionId: string) => openPane(ctx, sessionId, reactOf),
  };
  const disposeInjection = ctx.slots.inject("conversation.view", registration);
  return {
    registration,
    dispose() {
      if (typeof disposeInjection === "function") (disposeInjection as () => void)();
    },
  };
}
