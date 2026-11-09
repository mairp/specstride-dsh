/**
 * T024 — the client half (HF-17, F121-FR-003), on the dsh rc.8 client contract
 * (the shape of dsh-client-ui-trajectory): a cordis plugin `{ inject, apply }`
 * with NO default export (the loader's `unwrapExports` takes `exports.default ??
 * exports`, so a default would drop `inject` and every `ctx.<service>` read would
 * throw "cannot get property … without inject"). `apply` registers the
 * `specstride-kanban` locale namespace and one `conversation.view` entry through
 * `ctx.slots.inject(name, () => ctx.slots.register(registration, KanbanView))`.
 * The view component owns its container and opens the pane on mount: one fetch
 * per answer (poller), rendering through the shared board tree and the React
 * adapter. The module defines no browser-global property and no stored key: the
 * DOM is confined to the pane container and its style tag.
 */
import { startPanePoller, type Pane as PollerPane } from "./poller.ts";
import { toReact } from "./react-adapter.ts";
import { boardTree } from "../shared/board-tree.ts";
import styles from "./generated-styles.ts";

export const VIEW_PATH = "/specstride/view";
export { POLL_MS } from "./poller.ts";
export { toReact } from "./react-adapter.ts";

type TreeNode = { tag: string; attrs: Readonly<Record<string, string>>; text?: string; children: readonly TreeNode[] };
type Reactish = { createElement: (...args: unknown[]) => unknown };
type Timers = { setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (timer: unknown) => void };

/** The services this plugin reads; cordis refuses any other `ctx.<service>` read. */
export const inject = ["slots", "locale"];

/** The locale namespace this plugin owns (the registration's `locale` field). */
export const NS = "specstride-kanban";
export const en = { "view.kanban": "Kanban" };
export const zh = { "view.kanban": "看板" };

type Slots = {
  inject: (name: string, factory: () => unknown) => unknown;
  register: (registration: Record<string, unknown>, component: unknown) => unknown;
};
type Locale = {
  register: (ns: string, dictionaries: Record<string, Record<string, string>>) => unknown;
  bind: (ns: string) => (key: string) => string;
};
export type ClientCtx = {
  slots: Slots;
  locale: Locale;
  effect?: (body: () => unknown, label?: string) => unknown;
};

/** An open pane: dispose it, or open/close the detail of one card (F121-FR-022). */
export type Pane = { dispose: () => void; select: (cardId: string | null) => void; selected: () => string | null };

/** Where a pane draws: the imperative container (style tag, notes) and the board element sink. */
export type PaneHost = {
  container?: unknown;
  update?: (element: unknown) => void;
};

type Docish = { querySelector?: (selector: string) => { getAttribute?: (name: string) => string | null } | null } | undefined;

/** The view token of this page load, from the index tap's meta (R5, T-41). */
function tokenOf(doc: Docish): string | null {
  const meta = doc?.querySelector?.(`meta[name="specstride-view-token"]`);
  const value = meta?.getAttribute?.("content");
  return typeof value === "string" && value !== "" ? value : null;
}

export function openPane(host: PaneHost, sessionId: string, reactOf: () => Reactish | undefined, timers: Timers = globalThis): Pane {
  const pane = host;
  const container = pane.container as
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

  // No `specstride-view-token` meta in the page means the server half is not
  // running (the fail-open loader of F121-FR-002 registered nothing): one
  // unavailable line, zero requests, no retry (research.md R12, HF-26).
  const canSeePage = typeof (doc as { querySelector?: unknown } | undefined)?.querySelector === "function";
  if (canSeePage && tokenOf(doc) === null) {
    const note = doc?.createElement("div");
    note?.setAttribute?.("data-kanban-unavailable", "");
    if (note !== undefined) {
      note.textContent = "Kanban unavailable — run /specstride-doctor";
      container?.appendChild?.(note);
    }
    return {
      dispose() {
        if (style !== undefined) {
          if (typeof style.remove === "function") style.remove();
          else style.parentNode?.removeChild(style);
        }
      },
      select() {},
      selected: () => null,
    };
  }

  let latestView: Record<string, unknown> | undefined;
  let selectedId: string | null = null;
  const show = (tree: TreeNode, view?: Record<string, unknown>): void => {
    if (view !== undefined) latestView = view;
    const react = reactOf();
    if (react !== undefined) pane.update?.(toReact(tree, react));
  };
  /**
   * The staleness line enters the pane as text, never as markup (F121-FR-012).
   * ONE status node per pane, rewritten in place: a poll that keeps failing must
   * not stack a new line on every tick.
   */
  let statusNode: { textContent?: string } | undefined;
  /** A good answer voids the staleness line shown after an earlier failure. */
  const fresh = (): void => {
    if (statusNode !== undefined && statusNode.textContent !== "") statusNode.textContent = "";
  };
  const line = (text: string): void => {
    if (statusNode === undefined) {
      const node = doc?.createElement("div");
      if (node === undefined) return;
      node.setAttribute("data-kanban-status", "");
      node.textContent = text;
      container?.appendChild?.(node);
      statusNode = node;
      return;
    }
    statusNode.textContent = text;
  };
  const poller: PollerPane = startPanePoller(
    {
      sessionId,
      timers,
      render: (tree, _react, view) => show(tree, view),
      stale: line,
      message: line,
      fresh,
      token: tokenOf(doc),
      selected: () => selectedId,
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
    },
    // Opening or closing a detail re-renders the newest view at once — no fetch.
    select(cardId) {
      selectedId = cardId;
      if (latestView !== undefined) show(boardTree(latestView as never, { selectedId }) as TreeNode);
    },
    selected: () => selectedId,
  };
}

type Eventish = {
  type?: string;
  key?: string;
  target?: unknown;
  preventDefault?: () => void;
};
type Elementish = {
  closest?: (selector: string) => Elementish | null;
  getAttribute?: (name: string) => string | null;
  focus?: () => void;
  querySelector?: (selector: string) => Elementish | null;
  querySelectorAll?: (selector: string) => Iterable<Elementish>;
};

/**
 * The pointer and keyboard of the card detail (F121-FR-022). Delegated on the
 * pane's own wrapper — no handler travels through the tree (T006). A card with
 * a detail opens it on click, Enter or Space; the Close button and Escape close
 * it and give the focus back to the card; a second click on the open card closes it.
 */
export function detailEvent(event: Eventish, pane: Pick<Pane, "select" | "selected">, root?: Elementish | null): void {
  const target = event.target as Elementish | undefined;
  const closer = target?.closest?.("[data-kanban-detail-close]");
  const card = target?.closest?.("[data-has-detail]");
  const open = pane.selected();
  // React applies the new tree after this handler returns: focus on the next tick.
  const later = (fn: () => void): void => {
    if (typeof globalThis.setTimeout === "function") globalThis.setTimeout(fn, 0);
    else fn();
  };
  const refocus = (id: string | null): void => {
    if (id === null || root === null || root === undefined) return;
    later(() => {
      for (const node of root.querySelectorAll?.("[data-card-id]") ?? []) {
        if (node.getAttribute?.("data-card-id") === id) node.focus?.();
      }
    });
  };
  if (event.type === "keydown") {
    if (event.key === "Escape" && open !== null) {
      event.preventDefault?.();
      pane.select(null);
      refocus(open);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && card !== null && card !== undefined) {
      event.preventDefault?.();
      const id = card.getAttribute?.("data-card-id") ?? null;
      pane.select(id === open ? null : id);
      return;
    }
    return;
  }
  if (closer !== null && closer !== undefined) {
    pane.select(null);
    refocus(open);
    return;
  }
  if (card !== null && card !== undefined) {
    const id = card.getAttribute?.("data-card-id") ?? null;
    pane.select(id === open ? null : id);
    if (id !== open) later(() => root?.querySelector?.("[data-detail-title]")?.focus?.());
  }
}

type Hooks = {
  createElement: (...args: unknown[]) => unknown;
  useRef?: <T>(value: T) => { current: T };
  useState?: <T>(value: T) => [T, (next: T) => void];
  useEffect?: (effect: () => (() => void) | void, deps: readonly unknown[]) => void;
};

/** The loader's `require` (the bundle factory's parameter); absent under node tests. */
declare const require: ((id: string) => unknown) | undefined;

function loaderReact(): Reactish | undefined {
  try {
    return (typeof require === "function" ? require("react") : undefined) as Reactish | undefined;
  } catch {
    return undefined;
  }
}

/**
 * The view component: an outer `.ssk-00000000` box (the stylesheet's scope), one
 * React-empty child the pane appends its style tag and notes to, and the board
 * element the poller hands over. The pane opens on mount and is disposed on unmount.
 */
export function kanbanView(reactOf: () => Reactish | undefined): (props: { sessionId: string }) => unknown {
  return function KanbanView(props: { sessionId: string }): unknown {
    const React = reactOf() as Hooks | undefined;
    if (React?.useRef === undefined || React.useState === undefined || React.useEffect === undefined) return null;
    const ref = React.useRef<unknown>(null);
    const outer = React.useRef<unknown>(null);
    const paneRef = React.useRef<Pane | null>(null);
    const [board, setBoard] = React.useState<unknown>(null);
    React.useEffect(() => {
      const pane = openPane({ container: ref.current ?? undefined, update: setBoard }, props.sessionId, reactOf);
      paneRef.current = pane;
      return () => {
        paneRef.current = null;
        pane.dispose();
      };
    }, [props.sessionId]);
    const onEvent = (event: Eventish): void => {
      const pane = paneRef.current;
      if (pane !== null) detailEvent(event, pane, outer.current as Elementish | null);
    };
    return React.createElement(
      "div",
      { className: "ssk-00000000", "data-kanban-pane": "", ref: outer, onClick: onEvent, onKeyDown: onEvent },
      React.createElement("div", { ref, "data-kanban-host": "" }),
      board,
    );
  };
}

/** The `conversation.view` registration: `{ name, id, order, locale: NS, label, inject }`. */
export function kanbanRegistration(t: (key: string) => string): Record<string, unknown> {
  return {
    name: "conversation.view",
    id: "kanban",
    order: 20,
    locale: NS,
    label: () => t("view.kanban"),
    inject: (sessionId: string) => ({ sessionId }),
  };
}

/** The cordis plugin body: the locale namespace, then the one view tab. Unload disposes both. */
export function apply(ctx: ClientCtx, _config?: unknown, reactOf: () => Reactish | undefined = loaderReact): void {
  const registerLocale = () => ctx.locale.register(NS, { en, zh });
  if (typeof ctx.effect === "function") ctx.effect(registerLocale, "specstride-kanban: dictionaries");
  else registerLocale();
  const t = ctx.locale.bind(NS);
  const View = kanbanView(reactOf);
  ctx.slots.inject("conversation.view", () => ctx.slots.register(kanbanRegistration(t), View));
}
