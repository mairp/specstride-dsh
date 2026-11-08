/**
 * T024 — the client half (HF-17, F121-FR-003). One `inject("conversation.view", …)`
 * whose registration is `{ name, id, order, locale, label, inject }`; `inject(sessionId)`
 * opens the pane: one fetch per answer for now (poller), rendering through the
 * shared board tree and the React adapter, laid out through `ctx.layout` (HF-18,
 * settling check pending). The module defines no browser-global property and no
 * stored key: the DOM is confined to the pane container and its style tag.
 */
import { boardTree } from "../shared/board-tree.ts";
import { toReact } from "./react-adapter.ts";

export const VIEW_PATH = "/specstride/view";
export const POLL_MS = 5000;

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

function openPane(ctx: Ctx, sessionId: string, reactOf: () => Reactish | undefined): Pane {
  const timers = timersOf(ctx);
  const controller = new AbortController();
  let timer: unknown;
  let style: { remove?: () => void; parentNode?: { removeChild: (child: unknown) => void } } | undefined;
  let latest: TreeNode | undefined;
  const pane = ctx.layout?.({
    id: "kanban",
    render: (node: TreeNode, react: Reactish) => toReact(node, react),
  }) as { mount?: () => unknown; unmount?: () => void; container?: unknown; update?: (element: unknown) => void } | undefined;
  const container = (pane?.mount?.() ?? pane?.container ?? undefined) as
    | { ownerDocument?: { createElement: (tag: string) => { setAttribute: (name: string, value: string) => void; remove?: () => void; parentNode?: { removeChild: (child: unknown) => void } } }; appendChild?: (child: unknown) => void }
    | undefined;
  const doc = container?.ownerDocument;
  if (doc !== undefined) {
    const element = doc.createElement("style");
    element.setAttribute("data-kanban-style", "");
    container?.appendChild?.(element);
    style = element;
  }

  async function tick(): Promise<void> {
    if (controller.signal.aborted) return;
    try {
      const response = await fetch(`${VIEW_PATH}?session=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
      const value = (await response.json()) as { answer?: string; view?: Parameters<typeof boardTree>[0] };
      if (value?.answer === "view" && value.view !== undefined) {
        latest = boardTree(value.view);
        const react = reactOf();
        if (react !== undefined) pane?.update?.(toReact(latest, react));
      }
    } catch {
      // network error, aborted: keep the last view (the staleness banner lands with US2)
    }
    if (!controller.signal.aborted) timer = timers.setTimeout?.(() => void tick(), POLL_MS);
  }

  void tick();

  return {
    dispose() {
      controller.abort();
      if (timer !== undefined) timers.clearTimeout?.(timer);
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
