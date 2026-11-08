window.__ModuleLoader__.load({
  id: "@specstride/dsh-kanban",
  factory: (require) => {
    const __table = {
    "client/index": function (module, exports) {
      /**
       * T024 — the client half (HF-17, F121-FR-003). One `inject("conversation.view", …)`
       * whose registration is `{ name, id, order, locale, label, inject }`; `inject(sessionId)`
       * opens the pane: one fetch per answer for now (poller), rendering through the
       * shared board tree and the React adapter, laid out through `ctx.layout` (HF-18,
       * settling check pending). The module defines no browser-global property and no
       * stored key: the DOM is confined to the pane container and its style tag.
       */
      const __m1 = __load("shared/board-tree"); const { boardTree } = __m1;
      const __m2 = __load("client/react-adapter"); const { toReact } = __m2;
      
      const VIEW_PATH = "/specstride/view";
      const POLL_MS = 5000;
      
                                                                                                                             
                                                                         
                                                                                                                      
      
                  
                                                                              
                                                                  
                        
                       
        
      
                                          
      
      function timersOf(ctx                 )         {
        return (ctx?.timer                      ) ?? globalThis;
      }
      
      function openPane(ctx     , sessionId        , reactOf                            )       {
        const timers = timersOf(ctx);
        const controller = new AbortController();
        let timer         ;
        let style                                                                                             ;
        let latest                      ;
        const pane = ctx.layout?.({
          id: "kanban",
          render: (node          , react          ) => toReact(node, react),
        })                                                                                                                         ;
        const container = (pane?.mount?.() ?? pane?.container ?? undefined)   
                                                                                                                                                                                                                                                
                     ;
        const doc = container?.ownerDocument;
        if (doc !== undefined) {
          const element = doc.createElement("style");
          element.setAttribute("data-kanban-style", "");
          container?.appendChild?.(element);
          style = element;
        }
      
        async function tick()                {
          if (controller.signal.aborted) return;
          try {
            const response = await fetch(`${VIEW_PATH}?session=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
            const value = (await response.json())                                                               ;
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
      function start(ctx                                            , require                          )                                                                 {
        const reactOf = () => {
          try {
            const react = typeof require === "function" ? require("react") : undefined;
            return react                        ;
          } catch {
            return undefined;
          }
        };
        const locale = typeof ctx.locale === "string" ? ctx.locale : "en";
        const registration                          = {
          name: "conversation.view",
          id: "kanban",
          order: 20,
          locale,
          label: () => "Kanban",
          inject: (sessionId        ) => openPane(ctx, sessionId, reactOf),
        };
        const disposeInjection = ctx.slots.inject("conversation.view", registration);
        return {
          registration,
          dispose() {
            if (typeof disposeInjection === "function") (disposeInjection              )();
          },
        };
      }
      
      exports.default = start;
      exports.VIEW_PATH = VIEW_PATH;
      exports.POLL_MS = POLL_MS;
    },
    "client/react-adapter": function (module, exports) {
      /**
       * T024 — the React adapter (F121-FR-003). The element tree becomes
       * `React.createElement` calls 1:1: one call per node, attributes passed
       * through as plain strings, text only ever a child string — there is no
       * `dangerouslySetInnerHTML` anywhere (F121-FR-012).
       */
      
                       
                             
                                                         
                               
                                               
        
      
                                                                         
      
      function toReact(node          , react          , key = "0")          {
        const children =
          node.text !== undefined
            ? [node.text]
            : node.children.map((child, index) => toReact(child, react, `${key}.${index}`));
        return react.createElement(node.tag, { ...node.attrs, key }, ...children);
      }
      
      exports.toReact = toReact;
    },
    "shared/board-model": function (module, exports) {
      /**
       * T020 — the board model (contracts/presentation.md "Board model"; F121-FR-005,
       * F121-FR-006, F121-FR-008, F121-FR-010, F121-FR-014).
       *
       * Pure and DOM-free in its decisions: a function of the view and the options
       * only. A card's column is its own `card.lane` and nothing else — the engine
       * derived the lane, this plugin derives none (F121-FR-006; the scan rule
       * `no-lane-assignment` holds `columnOf` to `card.lane` only). No clock: the
       * client's staleness time arrives already formatted as a string.
       *
       * Each card carries the element-tree node its renderer will place (T021's
       * `cardNode`, built here so model and tree cannot drift); the decisions of the
       * model itself never read that node.
       */
      const __m1 = __load("shared/generated/contract-values"); const { LANES } = __m1;
      const __m2 = __load("shared/tree"); const { el, txt } = __m2;
                                                               
      
                                                        
                                                                             
      
                                 
                                                                                   
                                 
                                                                                    
                      
                                                                                          
                         
                                                                                               
                                     
                                                                                 
                                    
        
      
                                                                                                                    
                                                                                                                           
                                                                                                                                            
      
                                
                                        
                                        
                                           
                              
                                     
                           
                       
                          
        
      
                                  
                                                                             
                        
                                                                                       
                                               
                                                                                      
                                 
                                                                                          
                                         
        
      
      const NO_RUN_TEXT = "No Specstride run in this workspace";
      const NO_RUN_NOTE = "No run";
      const NO_FEATURE_LABEL = "no feature";
      
      /* -------------------------------- card node (T021) -------------------------------- */
      
      /**
       * The tree node of one card (contracts/presentation.md "Element tree"): exactly
       * the four attributes, so a test can deep-equal them; the text is the title,
       * inserted as text (F121-FR-012).
       */
      function cardNode(card          )       {
        const feature = card.feature === null ? NO_FEATURE_LABEL : card.feature;
        const phase = card.phase === null ? "?" : String(card.phase);
        const flags         = [];
        const named                                           = [
          ["dead", card.flags.dead],
          ["stale", card.flags.stale],
          ["yielded", card.flags.yielded],
        ];
        for (const [name, set] of named) {
          if (set === true) flags.push(txt("span", { "aria-label": name, "data-flag": name }, name));
        }
        return el("div", {
          "data-card-id": card.id,
          "data-lane": card.lane,
          "data-rule-id": card.ruleId,
          "data-feature": card.feature ?? "",
        }, [txt("span", {}, `${feature} · phase ${phase}`), ...flags]);
      }
      
      const boardCard = (card          )            => ({ ...card, node: cardNode(card) });
      
      /* ------------------------------ lane membership ---------------------------------- */
      
      function isKnownLane(name        )          {
        return (LANES                     ).includes(name);
      }
      
      /** Unknown lane values in order of first appearance, `view.lanes[]` then `view.cards[]`. */
      function unknownLanesOf(view          )           {
        const found           = [];
        const seen = new Set        ();
        const push = (name        ) => {
          if (!isKnownLane(name) && !seen.has(name)) {
            seen.add(name);
            found.push(name);
          }
        };
        for (const entry of view.lanes) push(entry.lane);
        for (const card of view.cards) push(card.lane);
        return found;
      }
      
      /** Lane membership, kept out of `columnOf` so its body reads `card.lane` only. */
      function columnHolds(column             , name        )          {
        return column.lanes.includes(name);
      }
      
      /**
       * The column that holds a card. Reads `card.lane` and nothing else of the card:
       * the placement is the engine's, never re-derived (F121-FR-006).
       */
      function columnOf(card          , columns                        )                     {
        for (const column of columns) {
          if (columnHolds(column, card.lane)) return column;
        }
        return null;
      }
      
      /* ------------------------------ ordering and grouping ----------------------------- */
      
      /** Card ids of one lane: `view.lanes[]` order first, then the rest in `view.cards` order. */
      function orderedCardsOfLane(view          , name        )             {
        const byId = new Map                  ();
        for (const card of view.cards) byId.set(card.id, card);
        const listed             = [];
        const seen = new Set        ();
        for (const entry of view.lanes) {
          if (entry.lane !== name) continue;
          for (const id of entry.cards) {
            const card = byId.get(id);
            if (card !== undefined && card.lane === name && !seen.has(id)) {
              seen.add(id);
              listed.push(card);
            }
          }
        }
        for (const card of view.cards) {
          if (card.lane === name && !seen.has(card.id)) {
            seen.add(card.id);
            listed.push(card);
          }
        }
        return listed;
      }
      
      /** Group by feature, first appearance first, the null-feature group last. */
      function groupByFeature(cards                      )              {
        const order           = [];
        const byFeature = new Map                            ();
        for (const card of cards) {
          const feature = card.feature;
          if (!byFeature.has(feature)) {
            byFeature.set(feature, []);
            if (feature !== null) order.push(feature);
          }
          (byFeature.get(feature)               ).push(card);
        }
        const groups              = [];
        for (const feature of order) groups.push({ feature, cards: byFeature.get(feature)                });
        const none = byFeature.get(null);
        if (none !== undefined) groups.push({ feature: null, cards: none });
        return groups;
      }
      
      /* ---------------------------------- columns -------------------------------------- */
      
      function emptyColumn(names                   , unknown         )              {
        return { lanes: [...names], label: names.join(", "), unknown, groups: [], cards: [] };
      }
      
      function columnsOf(view                 )                {
        const known                = LANES.map((name) => emptyColumn([name], false));
        const trailing                = unknownLanesOf(view ?? { lanes: [], cards: [] }                       ).map((name) =>
          emptyColumn([name], true),
        );
        return [...known, ...trailing];
      }
      
      function fillColumns(view          , columns                        )                {
        return columns.map((column) => {
          const cards = column.lanes.flatMap((name) => orderedCardsOfLane(view, name)).map(boardCard);
          return { ...column, groups: groupByFeature(cards), cards };
        });
      }
      
      /** Consumer-only merge (F121-FR-006): one column per group, at the first member's place. */
      function applyMerge(columns                        , merge                                )                {
        let out = [...columns];
        for (const group of merge) {
          const members = group.map((name) => out.find((column) => column.lanes.length === 1 && column.lanes[0] === name));
          if (members.some((member) => member === undefined)) continue;
          const first = out.indexOf(members[0]);
          const mergedCards = members.flatMap((member) => [...(member               ).cards]);
          const merged              = {
            lanes: members.map((member) => (member               ).lanes[0] ?? ""),
            label: members.map((member) => (member               ).label).join(", "),
            unknown: members.some((member) => (member               ).unknown),
            groups: groupByFeature(mergedCards),
            cards: mergedCards,
          };
          const kept                = [];
          out.forEach((column, index) => {
            if (index === first) kept.push(merged);
            else if (!members.includes(column)) kept.push(column);
          });
          out = kept;
        }
        return out;
      }
      
      /** Consumer-only hide (F121-FR-006): a column whose every lane is hidden is dropped. */
      function applyHide(columns                        , hide                   )                {
        if (hide.length === 0) return [...columns];
        return columns.filter((column) => !column.lanes.every((name) => hide.includes(name)));
      }
      
      /* ------------------------------- banners and rows -------------------------------- */
      
      function bannersOf(view                 , options              )                {
        const banners                = [];
        if (view !== null) {
          if (view.conditions.dead) banners.push({ condition: "dead", text: "Run is dead" });
          if (view.conditions.stale !== null) {
            banners.push({ condition: "stale", text: `View is stale: ${view.conditions.stale.reason}` });
          }
          if (view.conditions.launchAbandoned) banners.push({ condition: "launch-abandoned", text: "Launch abandoned" });
        }
        if (options.clientStaleSince !== undefined && options.clientStaleSince !== null) {
          banners.push({ condition: "client-stale", text: `Not updated since ${options.clientStaleSince}` });
        }
        return banners;
      }
      
      function attentionOf(view                 )                                         {
        if (view === null) return { rows: [], more: 0 };
        return {
          rows: view.attention.map((item) => ({ kind: item.kind, key: item.key, since: item.since, oneLine: item.oneLine, need: item.need })),
          more: view.attentionOmitted,
        };
      }
      
      function budgetText(scope        , role               , level        , spent               , cap               )         {
        const who = role === null ? scope : `${scope} ${role}`;
        const mark = (value               ) => (value === null ? "–" : String(value));
        return `${who} ${level} ${mark(spent)}/${mark(cap)}`;
      }
      
      function budgetOf(view                 )                                      {
        if (view === null) return { rows: [], more: 0 };
        return {
          rows: view.budget.map((row) => ({
            scope: row.scope,
            role: row.role,
            level: row.level,
            spent: row.spent,
            cap: row.cap,
            text: budgetText(row.scope, row.role, row.level, row.spent, row.cap),
          })),
          more: view.budgetOmitted,
        };
      }
      
      /* ----------------------------------- boardOf -------------------------------------- */
      
      function boardOf(view                 , options               = {})             {
        const noRun = options.answer === "no-run" || (view !== null && view.state === "none");
        let columns = fillColumns(view ?? EMPTY_VIEW, columnsOf(view));
        columns = applyHide(applyMerge(columns, options.merge ?? []), options.hide ?? []);
        const attention = attentionOf(view);
        const budget = budgetOf(view);
        return {
          columns,
          banners: bannersOf(view, options),
          attention: attention.rows,
          attentionMore: attention.more,
          budget: budget.rows,
          budgetMore: budget.more,
          noRun,
          noRunText: NO_RUN_TEXT,
        };
      }
      
      /* --------------------- the T012 aliases (buildColumns, buildBoard) ----------------- */
      
                                                                                                                              
                                                                                                                    
                                                                             
      
      const parityCard = (card           )             => ({ cardId: card.id, lane: card.lane, ruleId: card.ruleId, feature: card.feature, phase: card.phase });
      
      /** The columns of the view alone (no consumer merge, no hide). */
      function buildColumns(view          )                 {
        return boardOf(view, { answer: "view" }).columns.map((column) => ({
          lane: column.lanes[0] ?? null,
          groups: column.groups.map((group) => ({ feature: group.feature, cards: group.cards.map(parityCard) })),
        }));
      }
      
      /** The columns plus the note lines ("No run" for a workspace without a run). */
      function buildBoard(view          )              {
        const board = boardOf(view, { answer: "view" });
        return {
          columns: buildColumns(view),
          notes: board.noRun ? [NO_RUN_NOTE] : [],
        };
      }
      
      const EMPTY_VIEW           = {
        schema: "specstride.view/1",
        runId: null,
        workspaceId: null,
        feature: null,
        state: "none",
        display: "none",
        conditions: { dead: false, stale: null, launchAbandoned: false },
        cards: [],
        lanes: [],
        laneTable: { id: "lane-table", version: "1" },
        attention: [],
        attentionOmitted: 0,
        budget: [],
        budgetOmitted: 0,
        phases: [],
        cursor: { offset: 0, lastSeq: 0 },
        signature: { token: "" },
      };
      
      exports.cardNode = cardNode;
      exports.columnOf = columnOf;
      exports.boardOf = boardOf;
      exports.buildColumns = buildColumns;
      exports.buildBoard = buildBoard;
      exports.NO_RUN_TEXT = NO_RUN_TEXT;
      exports.NO_RUN_NOTE = NO_RUN_NOTE;
      exports.NO_FEATURE_LABEL = NO_FEATURE_LABEL;
    },
    "shared/board-tree": function (module, exports) {
      /**
       * T021 — the board element tree (contracts/presentation.md "Element tree and
       * attributes"; F121-FR-008, F121-FR-009, F121-FR-012, F121-FR-014).
       *
       * A pure function: equal input (view or board model of T020), equal tree —
       * byte-equal under `serialize`. Every run text enters as a `text` field of the
       * T006 tree; there is no markup path. Presentation (glyph, label, grayscale)
       * comes from T035; until it lands the tree carries the label text only, and
       * card flags render as badges with `aria-label` and the label as their text.
       */
      const __m1 = __load("shared/tree"); const { el, txt } = __m1;
      const __m2 = __load("shared/board-model"); const { boardOf } = __m2;
                                                     
      
                                 
                                                                                                                    
                        
        
      
      const DEFAULT_PREFIX = "ssk00000000";
      
      /** The board of a view (the route's `view` answer) or of an already-built model. */
      function boardTree(input                       , options              = {})       {
        const prefix = options.prefix ?? DEFAULT_PREFIX;
        const board             = "banners" in input ? (input              ) : boardOf(input            , { answer: "view" });
      
        const children         = [];
        for (const banner of board.banners) {
          children.push(txt("div", { role: "status", "data-condition": banner.condition }, banner.text));
        }
        if (board.noRun) {
          children.push(txt("div", { role: "status", "data-norun": "true" }, board.noRunText));
        }
      
        for (const column of board.columns) {
          const count = column.cards.length;
          const attrs                         = {
            "aria-label": `${column.label}, ${count} cards`,
          };
          if (column.lanes.length === 1) attrs["data-lane"] = column.lanes[0] ?? "";
          else attrs["data-lanes"] = column.lanes.join(" ");
          if (column.unknown) attrs["data-unknown-lane"] = "true";
      
          const parts         = [txt("div", {}, column.label)];
          if (column.lanes.length > 1) parts.push(txt("div", {}, `holds ${column.lanes.join(", ")}`));
          for (const group of column.groups) {
            const header = group.feature === null ? "no feature" : group.feature;
            parts.push(el("div", { "data-feature": group.feature ?? "" }, [txt("div", {}, header), ...group.cards.map((card) => card.node)]));
          }
          children.push(el("section", attrs, parts));
        }
      
        if (board.attention.length > 0 || board.attentionMore > 0) {
          const rows = board.attention.map((row) => {
            const parts = [txt("div", { "data-kind": row.kind }, row.oneLine)];
            if (row.need !== null) parts.push(txt("div", {}, row.need));
            return el("div", { "data-kind": row.kind }, parts);
          });
          if (board.attentionMore > 0) rows.push(txt("div", {}, `and ${board.attentionMore} more`));
          children.push(el("div", { "data-attention": "" }, rows));
        }
      
        if (board.budget.length > 0 || board.budgetMore > 0) {
          const rows = board.budget.map((row) => txt("div", { "data-level": row.level }, row.text));
          if (board.budgetMore > 0) rows.push(txt("div", {}, `and ${board.budgetMore} more`));
          children.push(el("div", { "data-budget": "" }, rows));
        }
      
        return el("div", {
          "data-kanban": "",
          role: "region",
          "aria-label": "Specstride run",
        }, children);
      }
      
      exports.boardTree = boardTree;
    },
    "shared/generated/contract-values": function (module, exports) {
      // GENERATED by scripts/gen-contract-values.ts — do not edit. core 0.1.0, @specstride/contracts tarball sha256 a1e4eb1322d17bb35d6391987db32f59010f6159da41a2ed1f07baf61b31dc22
      
      const SCHEMA_ID = "specstride.view/1"         ;
      
      const MAJOR_RANGE = Object.freeze({
        "from": 1,
        "to": 1
      })         ;
      
      const LANES = Object.freeze([
        "queued",
        "proposing",
        "verifying",
        "reviewing",
        "approved",
        "blocked",
        "paused",
        "failed"
      ])         ;
      
      const ATTENTION_KINDS = Object.freeze([
        "blocked-on-human",
        "source-changed",
        "dead-run",
        "launch-abandoned",
        "quota-pause",
        "budget-alert",
        "stale-run",
        "orphan-processes",
        "unknown-state"
      ])         ;
      
      const BUDGET_LEVELS = Object.freeze([
        "unknown",
        "ok",
        "info",
        "warn",
        "loud",
        "over"
      ])         ;
      
      const BOUNDS = Object.freeze({
        "timelineRows": 20,
        "attentionItems": 50,
        "budgetRows": 64,
        "listedProcesses": 50,
        "lanes": 8
      })         ;
      
      const TEXT_CAP_BYTES = 240         ;
      
      exports.SCHEMA_ID = SCHEMA_ID;
      exports.MAJOR_RANGE = MAJOR_RANGE;
      exports.LANES = LANES;
      exports.ATTENTION_KINDS = ATTENTION_KINDS;
      exports.BUDGET_LEVELS = BUDGET_LEVELS;
      exports.BOUNDS = BOUNDS;
      exports.TEXT_CAP_BYTES = TEXT_CAP_BYTES;
    },
    "shared/tree": function (module, exports) {
      /**
       * T006 — the element tree (research.md R7, data-model §9).
       *
       * Text is a separate field; there is no field for markup. A node never holds
       * both text and children. No attribute can be a handler or a markup sink.
       */
                          
                             
                                                         
                               
                                           
        
      
      const REFUSED_ATTRIBUTES = new Set(["innerHTML", "dangerouslySetInnerHTML"]);
      
      function checkedAttrs(attrs                                  )                         {
        const out                         = {};
        for (const name of Object.keys(attrs)) {
          if (REFUSED_ATTRIBUTES.has(name) || name.startsWith("on")) {
            throw new Error(`tree: attribute "${name}" is refused (no markup sink, no handler in the tree)`);
          }
          out[name] = String(attrs[name]);
        }
        return out;
      }
      
      /** Control characters U+0000–U+001F except tab, and U+007F–U+009F, become U+FFFD. */
      function cleanText(text        )         {
        return text.replace(/[\u0000-\u0008\u000A-\u001F\u007F-\u009F]/g, "�");
      }
      
      function el(tag        , attrs                                   = {}, children                  = [])       {
        return { tag, attrs: checkedAttrs(attrs), children: [...children] };
      }
      
      function txt(tag        , attrs                                  , text        )       {
        return { tag, attrs: checkedAttrs(attrs), text: cleanText(text), children: [] };
      }
      
      /** `JSON.stringify` with sorted attribute keys: equal trees give byte-equal text. */
      function serialize(node      )         {
        return JSON.stringify(node, (key, value         ) => {
          if (key === "attrs" && typeof value === "object" && value !== null) {
            const record = value                          ;
            return Object.fromEntries(Object.keys(record).sort().map((name) => [name, record[name]]));
          }
          return value;
        });
      }
      
      exports.cleanText = cleanText;
      exports.el = el;
      exports.txt = txt;
      exports.serialize = serialize;
    },
    "shared/view-read": function (module, exports) {
      /**
       * T011 — the acceptance rule (PT-121-004, F121-FR-004; research.md R4).
       *
       * A value is accepted when `schema` is `specstride.view/<n>` with `n` inside
       * the generated major range and the fields the plugin reads have their JSON
       * types. Members of the three closed sets are NOT checked against the enums:
       * a newer engine inside the major renders with `?` (F121-FR-014).
       */
      const __m1 = __load("shared/generated/contract-values"); const { SCHEMA_ID, MAJOR_RANGE } = __m1;
      
                              
                   
                               
                             
                     
                       
                                                                      
        
                                                                                                                                          
                                
                      
                            
                      
                             
                           
                                
                      
        
                              
                       
                             
                                   
                               
                      
                        
                                                                                                                                                        
                          
                                                   
                                                   
                                   
                                 
                             
                              
                                                           
                                                    
                                     
        
      
                                                                                            
      
                                         
      const isRec = (v         )           => typeof v === "object" && v !== null && !Array.isArray(v);
      const isStr = (v         )              => typeof v === "string";
      const isStrOrNull = (v         )          => v === null || isStr(v);
      const isInt = (v         )              => typeof v === "number" && Number.isInteger(v);
      const isNum = (v         )          => typeof v === "number" && Number.isFinite(v);
      const isNumOrNull = (v         )          => v === null || isNum(v);
      const isBool = (v         )               => typeof v === "boolean";
      const each = (v         , test                        )          => Array.isArray(v) && v.every((item) => isRec(item) && test(item));
      
      const SCHEMA_PATTERN = /^specstride\.view\/(\d+)$/;
      
      function majorOf(schema         )                {
        if (!isStr(schema)) return null;
        const match = SCHEMA_PATTERN.exec(schema);
        return match === null ? null : Number.parseInt(match[1]          , 10);
      }
      
      function fieldsHoldTheirTypes(v     )          {
        const conditions = v.conditions;
        return (
          isStrOrNull(v.runId) && isStrOrNull(v.workspaceId) && isStrOrNull(v.feature) &&
          isStr(v.state) && isStr(v.display) &&
          isRec(conditions) && isBool(conditions.dead) && isBool(conditions.launchAbandoned) &&
          (conditions.stale === null || (isRec(conditions.stale) && isStr(conditions.stale.reason))) &&
          each(v.cards, (c) => isStr(c.id) && isStrOrNull(c.feature) && (c.phase === null || isInt(c.phase)) && isStr(c.lane) && isStr(c.ruleId) && isRec(c.flags)) &&
          each(v.lanes, (l) => isStr(l.lane) && Array.isArray(l.cards) && l.cards.every(isStr)) &&
          isRec(v.laneTable) && isStr(v.laneTable.id) && isStr(v.laneTable.version) &&
          each(v.attention, (a) => isStr(a.kind) && isStr(a.key) && isStrOrNull(a.since) && isStr(a.oneLine) && isStrOrNull(a.need) && isStr(a.next)) &&
          isInt(v.attentionOmitted) && v.attentionOmitted >= 0 &&
          each(v.budget, (b) => isStr(b.scope) && isStrOrNull(b.role) && isStr(b.level) && isNumOrNull(b.spent) && isNumOrNull(b.cap) && isNumOrNull(b.fraction) && isStr(b.quota)) &&
          isInt(v.budgetOmitted) && v.budgetOmitted >= 0 &&
          each(v.phases, (p) => isInt(p.number) && isStrOrNull(p.title)) &&
          isRec(v.cursor) && isInt(v.cursor.offset) && isInt(v.cursor.lastSeq) &&
          isRec(v.signature) && isStr(v.signature.token)
        );
      }
      
      function refusalLine(found        )         {
        return `Kanban cannot read this view (schema ${found}, supported ${SCHEMA_ID}) — run /specstride-doctor`;
      }
      
      function acceptView(value         )               {
        if (!isRec(value)) return { ok: false, line: refusalLine("none") };
        const found = isStr(value.schema) ? value.schema : "none";
        const major = majorOf(value.schema);
        if (major === null || major < MAJOR_RANGE.from || major > MAJOR_RANGE.to) return { ok: false, line: refusalLine(found) };
        if (!fieldsHoldTheirTypes(value)) return { ok: false, line: refusalLine(found) };
        return { ok: true, view: value                        };
      }
      
      exports.refusalLine = refusalLine;
      exports.acceptView = acceptView;
    },
    };
    const __cache = {};
    const __default = (m) => (m && m.__esModule ? m.default : m);
    const __load = (id) => {
      if (__cache[id] === undefined) {
        const module = { exports: {} };
        __cache[id] = module;
        Object.defineProperty(module.exports, "__esModule", { value: true });
        __table[id](module, module.exports);
      }
      return __cache[id].exports;
    };
    return __load("client/index");
  },
});
