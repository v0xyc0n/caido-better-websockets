import type { Caido } from "@caido/sdk-frontend";

// ─── Types ────────────────────────────────────────────────────────────────────

type StreamMeta = {
  id: string;
  host: string;
  path: string;
  isTls: boolean;
  createdAt: Date;
};

type WsStreamMessage = {
  direction: string;
  format: string;
  raw: string;
};

type WsStream = {
  meta: StreamMeta;
  messages: WsStreamMessage[];
};

// ─── WebSocket Data Fetching ──────────────────────────────────────────────────

async function fetchStreamList(
  sdk: Caido,
  limit: number = 20
): Promise<StreamMeta[]> {
  const result = await sdk.graphql.websocketStreamsByOffset({
    offset: 0,
    limit,
    order: { by: "ID", ordering: "DESC" },
  });
  return result.streamsByOffset.edges.map((e) => ({
    id: e.node.id,
    host: e.node.host,
    path: e.node.path,
    isTls: e.node.isTls,
    createdAt: new Date(e.node.createdAt),
  }));
}

async function fetchWsStream(
  sdk: Caido,
  meta: StreamMeta
): Promise<WsStream> {
  const result = await sdk.graphql.websocketMessagesByOffset({
    streamId: meta.id,
    offset: 0,
    limit: 500,
    order: { by: "ID", ordering: "ASC" },
  });

  const nodes = result.streamWsMessagesByOffset.edges.map((e) => e.node);

  const messages = await Promise.all(
    nodes.map(async (msg) => {
      const editResult = await sdk.graphql.websocketMessageEdit({
        id: msg.head.id,
      });
      return {
        direction: msg.head.direction,
        format: msg.head.format,
        raw: editResult.streamWsMessageEdit?.raw ?? "(no content)",
      };
    })
  );

  return { meta, messages };
}

// ─── WebSocket Formatting ─────────────────────────────────────────────────────

function formatWsStream(stream: WsStream): string {
  const proto = stream.meta.isTls ? "wss" : "ws";
  const uri = `${proto}://${stream.meta.host}${stream.meta.path}`;
  const header = `${"─".repeat(72)}\n${uri}\n${"─".repeat(72)}`;

  const messageParts = stream.messages.map((msg, i) => {
    const dir = msg.direction === "CLIENT" ? "→ CLIENT" : "← SERVER";
    return `--- Message ${i + 1} [${dir}] (${msg.format}) ---\n${msg.raw.trimEnd()}`;
  });

  const body =
    messageParts.length > 0
      ? messageParts.join("\n\n")
      : "(no messages captured)";

  return [header, body].join("\n");
}

function formatWsBundle(stream: WsStream): string {
  const ts = new Date().toISOString();
  const n = stream.messages.length;
  const header = [
    `# Better Websockets — WebSocket stream (${n} message${n === 1 ? "" : "s"})`,
    `# Exported: ${ts}`,
    "",
  ].join("\n");
  return header + formatWsStream(stream) + "\n";
}

function makeWsFilename(stream: WsStream): string {
  const ts = new Date()
    .toISOString()
    .replace("T", "_")
    .replace(/[:.]/g, "-")
    .replace("Z", "");
  const safePath = stream.meta.path
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 60);
  return `ws_${stream.meta.host}_${safePath}_${ts}.txt`;
}

// ─── WebSocket Export ─────────────────────────────────────────────────────────

async function exportStream(
  sdk: Caido,
  streamId: string,
  action: "copy" | "save"
): Promise<void> {
  const list = await fetchStreamList(sdk, 100);
  const meta = list.find((s) => s.id === streamId) ?? {
    id: streamId,
    host: streamId,
    path: "",
    isTls: false,
    createdAt: new Date(),
  };

  sdk.window.showToast("Fetching messages…", { variant: "info", duration: 5000 });
  const stream = await fetchWsStream(sdk, meta);
  const n = stream.messages.length;
  const content = formatWsBundle(stream);

  if (action === "copy") {
    await navigator.clipboard.writeText(content);
    sdk.window.showToast(
      `Copied ${n} message${n === 1 ? "" : "s"} to clipboard!`,
      { variant: "success" }
    );
  } else {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = makeWsFilename(stream);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    sdk.window.showToast(
      `Saved ${n} message${n === 1 ? "" : "s"} to file!`,
      { variant: "success" }
    );
  }
}

// ─── Sidebar Page ─────────────────────────────────────────────────────────────

function buildWsPage(sdk: Caido): { body: HTMLElement; onEnter: () => void } {
  // ── root layout ─────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.style.cssText =
    "padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; width: 100%; box-sizing: border-box;";

  // ── heading ──────────────────────────────────────────────────────────────────
  const heading = document.createElement("h2");
  heading.textContent = "Better Websockets";
  heading.style.cssText = "margin: 0; font-size: 1.1rem; font-weight: 600;";
  root.appendChild(heading);

  // ── stream-ID input section ───────────────────────────────────────────────
  const inputCard = sdk.ui.well({});
  inputCard.style.cssText = "display: flex; flex-direction: column; gap: 0.75rem;";

  const label = document.createElement("label");
  label.textContent = "Stream ID";
  label.style.cssText = "font-size: 0.85rem; font-weight: 500;";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Paste a stream ID…";
  input.style.cssText = [
    "padding: 0.45rem 0.75rem",
    "border: 1px solid var(--c-border-default)",
    "background: var(--c-bg-default)",
    "color: var(--c-fg-default)",
    "border-radius: 4px",
    "font-family: monospace",
    "font-size: 0.875rem",
    "width: 100%",
    "box-sizing: border-box",
  ].join(";");

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 0.5rem;";

  const copyIdBtn = sdk.ui.button({
    variant: "primary",
    label: "Copy to Clipboard",
    leadingIcon: "fas fa-copy",
  });
  const saveIdBtn = sdk.ui.button({
    variant: "secondary",
    label: "Save to File",
    leadingIcon: "fas fa-floppy-disk",
  });

  const handleId = async (action: "copy" | "save") => {
    const id = input.value.trim();
    if (!id) {
      sdk.window.showToast("Paste a stream ID first.", { variant: "warning" });
      return;
    }
    try {
      await exportStream(sdk, id, action);
    } catch (err) {
      sdk.window.showToast(`Failed: ${err}`, { variant: "error" });
    }
  };

  copyIdBtn.addEventListener("click", () => handleId("copy"));
  saveIdBtn.addEventListener("click", () => handleId("save"));

  btnRow.appendChild(copyIdBtn);
  btnRow.appendChild(saveIdBtn);
  inputCard.appendChild(label);
  inputCard.appendChild(input);
  inputCard.appendChild(btnRow);
  root.appendChild(inputCard);

  // ── recent streams section ────────────────────────────────────────────────
  const recentSection = document.createElement("div");
  recentSection.style.cssText = "display: flex; flex-direction: column; gap: 0.5rem;";

  // filter row
  const filterRow = document.createElement("div");
  filterRow.style.cssText = "display: flex; align-items: center; gap: 1rem; font-size: 0.85rem;";

  const recentLabel = document.createElement("div");
  recentLabel.textContent = "Recent streams";
  recentLabel.style.cssText = "font-weight: 500;";

  const hideLabel = document.createElement("label");
  hideLabel.style.cssText = "display: flex; align-items: center; gap: 0.3rem; cursor: pointer; font-size: 0.85rem;";
  const radioHide = document.createElement("input");
  radioHide.type = "checkbox";
  radioHide.checked = true;
  hideLabel.appendChild(radioHide);
  hideLabel.appendChild(document.createTextNode("Hide Mozilla Push"));

  const previewStates = [
    { label: "Preview: Full",   tableFlexBasis: "50%", previewFlexBasis: "50%" },
    { label: "Preview: Small",  tableFlexBasis: "70%", previewFlexBasis: "30%" },
    { label: "Preview: Hidden", tableFlexBasis: "100%", previewFlexBasis: "0"  },
  ] as const;
  let previewStateIdx = 0;

  const previewToggleBtn = document.createElement("button");
  previewToggleBtn.textContent = previewStates[0].label;
  previewToggleBtn.style.cssText = [
    "font-size: 0.8rem",
    "padding: 0.2rem 0.6rem",
    "border: 1px solid var(--c-border-default)",
    "border-radius: 4px",
    "background: transparent",
    "color: var(--c-fg-default)",
    "cursor: pointer",
    "margin-left: auto",
  ].join(";");
  previewToggleBtn.addEventListener("click", () => {
    previewStateIdx = (previewStateIdx + 1) % previewStates.length;
    const state = previewStates[previewStateIdx];
    previewToggleBtn.textContent = state.label;
    tableWrapper.style.flexBasis = state.tableFlexBasis;
    previewPanel.style.flexBasis = state.previewFlexBasis;
    previewPanel.style.display = state.previewFlexBasis === "0" ? "none" : "";
  });

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search ID, host, path…";
  searchInput.style.cssText = [
    "flex: 1",
    "padding: 0.25rem 0.5rem",
    "border: 1px solid var(--c-border-default)",
    "border-radius: 4px",
    "background: var(--c-bg-default)",
    "color: var(--c-fg-default)",
    "font-size: 0.82rem",
    "min-width: 0",
  ].join(";");

  filterRow.appendChild(recentLabel);
  filterRow.appendChild(hideLabel);
  filterRow.appendChild(searchInput);
  filterRow.appendChild(previewToggleBtn);

  // ── table ─────────────────────────────────────────────────────────────────
  const PANEL_HEIGHT = "calc(15 * 2.1rem + 2.5rem)";

  const tableWrapper = document.createElement("div");
  tableWrapper.style.cssText = `overflow: auto; max-height: ${PANEL_HEIGHT}; border: 1px solid var(--c-border-default); border-radius: 4px; flex: 1 1 50%; min-width: 0;`;

  const table = document.createElement("table");
  table.tabIndex = 0;
  table.style.cssText = "width: 100%; min-width: 700px; border-collapse: collapse; table-layout: fixed; font-size: 0.82rem; font-family: monospace; outline: none;";

  const colgroup = document.createElement("colgroup");
  const colWidths = ["80px", "175px", "25%", "auto"];
  const cols: HTMLElement[] = colWidths.map((width) => {
    const col = document.createElement("col");
    col.style.width = width;
    colgroup.appendChild(col);
    return col;
  });
  table.appendChild(colgroup);

  // ── sort state ────────────────────────────────────────────────────────────
  let sortCol: "id" | "time" | "host" | "path" = "id";
  let sortDir: "asc" | "desc" = "desc";
  const sortIndicators: Partial<Record<string, HTMLSpanElement>> = {};

  function updateSortIndicators() {
    for (const [col, el] of Object.entries(sortIndicators)) {
      if (!el) continue;
      if (col === sortCol) {
        el.textContent = sortDir === "asc" ? " ▲" : " ▼";
        el.style.opacity = "1";
      } else {
        el.textContent = " ⇅";
        el.style.opacity = "0.35";
      }
    }
  }

  // ── thead ─────────────────────────────────────────────────────────────────
  const thead = document.createElement("thead");
  thead.style.cssText = "position: sticky; top: 0; z-index: 1; background: var(--c-bg-default);";
  const headerRow = document.createElement("tr");
  headerRow.style.cssText = "border-bottom: 2px solid var(--c-border-default);";

  function makeHeaderCell(label: string, sortKey: "id" | "time" | "host" | "path", colIndex: number): HTMLTableCellElement {
    const th = document.createElement("th");
    th.style.cssText = [
      "padding: 0.4rem 0.5rem",
      "text-align: left",
      "font-weight: 600",
      "cursor: pointer",
      "user-select: none",
      "white-space: nowrap",
      "position: relative",
    ].join(";");

    const indicator = document.createElement("span");
    indicator.style.cssText = "font-size: 0.7rem;";
    sortIndicators[sortKey] = indicator;

    th.appendChild(document.createTextNode(label));
    th.appendChild(indicator);

    th.addEventListener("click", () => {
      if (sortCol === sortKey) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = sortKey;
        sortDir = "asc";
      }
      updateSortIndicators();
      renderStreamList();
    });

    // resize handle — resizes the <col> element so table-layout: fixed honours it
    const handle = document.createElement("div");
    handle.style.cssText = "position:absolute;right:0;top:0;width:5px;height:100%;cursor:col-resize;";
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.pageX;
      const startW = th.offsetWidth;
      const colEl = cols[colIndex];
      const onMove = (e: MouseEvent) => {
        colEl.style.width = Math.max(60, startW + e.pageX - startX) + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    th.appendChild(handle);

    return th;
  }

  headerRow.appendChild(makeHeaderCell("ID", "id", 0));
  headerRow.appendChild(makeHeaderCell("Time", "time", 1));
  headerRow.appendChild(makeHeaderCell("Host", "host", 2));
  headerRow.appendChild(makeHeaderCell("Path", "path", 3));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // ── tbody ─────────────────────────────────────────────────────────────────
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  tableWrapper.appendChild(table);

  // ── preview panel ─────────────────────────────────────────────────────────
  const previewPanel = document.createElement("div");
  previewPanel.style.cssText = [
    `max-height: ${PANEL_HEIGHT}`,
    "display: flex",
    "flex-direction: column",
    "overflow: hidden",
    "flex: 1 1 50%",
    "min-width: 0",
    "border: 1px solid var(--c-border-default)",
    "border-radius: 4px",
    "background: var(--c-bg-subtle)",
  ].join(";");

  // ── preview search bar ───────────────────────────────────────────────────
  const previewSearchBar = document.createElement("div");
  previewSearchBar.style.cssText = [
    "display: flex",
    "align-items: center",
    "gap: 0.3rem",
    "padding: 0.3rem 0.5rem",
    "border-bottom: 1px solid var(--c-border-default)",
    "background: var(--c-bg-default)",
    "flex-shrink: 0",
  ].join(";");

  const previewSearchInput = document.createElement("input");
  previewSearchInput.type = "search";
  previewSearchInput.placeholder = "Find in preview…";
  previewSearchInput.style.cssText = [
    "flex: 1",
    "padding: 0.2rem 0.4rem",
    "border: 1px solid var(--c-border-default)",
    "border-radius: 3px",
    "background: var(--c-bg-subtle)",
    "color: var(--c-fg-default)",
    "font-size: 0.8rem",
    "min-width: 0",
  ].join(";");

  const matchCounter = document.createElement("span");
  matchCounter.style.cssText = "font-size: 0.75rem; opacity: 0.6; white-space: nowrap; min-width: 3rem; text-align: center;";

  const makeNavBtn = (symbol: string, title: string) => {
    const btn = document.createElement("button");
    btn.textContent = symbol;
    btn.title = title;
    btn.style.cssText = "padding: 0.1rem 0.4rem; border: 1px solid var(--c-border-default); border-radius: 3px; background: transparent; color: var(--c-fg-default); cursor: pointer; font-size: 0.8rem;";
    return btn;
  };
  const prevMatchBtn = makeNavBtn("▲", "Previous match");
  const nextMatchBtn = makeNavBtn("▼", "Next match");

  previewSearchBar.appendChild(previewSearchInput);
  previewSearchBar.appendChild(matchCounter);
  previewSearchBar.appendChild(prevMatchBtn);
  previewSearchBar.appendChild(nextMatchBtn);

  // ── preview scroll area ──────────────────────────────────────────────────
  const previewScrollArea = document.createElement("div");
  previewScrollArea.style.cssText = "flex: 1; overflow: auto; min-height: 0;";

  const previewPre = document.createElement("pre");
  previewPre.style.cssText = "margin: 0; padding: 0.75rem; font-size: 0.78rem; white-space: pre-wrap; word-break: break-all; color: var(--c-fg-subtle); user-select: text; cursor: text;";
  previewPre.textContent = "Click a row to preview the stream.";
  previewScrollArea.appendChild(previewPre);

  previewPanel.appendChild(previewSearchBar);
  previewPanel.appendChild(previewScrollArea);

  // ── preview search logic ─────────────────────────────────────────────────
  let previewRawText = "";
  let previewMatchIdx = 0;

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function applyPreviewSearch() {
    const term = previewSearchInput.value;
    if (!term || !previewRawText) {
      previewPre.innerHTML = escapeHtml(previewRawText) || "<span style='opacity:0.5'>Click a row to preview the stream.</span>";
      matchCounter.textContent = "";
      return;
    }

    const lowerText = previewRawText.toLowerCase();
    const lowerTerm = term.toLowerCase();
    const positions: number[] = [];
    let pos = 0;
    while ((pos = lowerText.indexOf(lowerTerm, pos)) !== -1) {
      positions.push(pos);
      pos += lowerTerm.length;
    }

    if (positions.length === 0) {
      previewPre.innerHTML = escapeHtml(previewRawText);
      matchCounter.textContent = "0 / 0";
      return;
    }

    previewMatchIdx = Math.min(previewMatchIdx, positions.length - 1);
    matchCounter.textContent = `${previewMatchIdx + 1} / ${positions.length}`;

    let html = "";
    let lastEnd = 0;
    positions.forEach((start, idx) => {
      const end = start + term.length;
      html += escapeHtml(previewRawText.slice(lastEnd, start));
      const isCurrent = idx === previewMatchIdx;
      html += `<mark id="pm-${idx}" style="background:${isCurrent ? "#f97316" : "#fde68a"};color:#000;border-radius:2px">${escapeHtml(previewRawText.slice(start, end))}</mark>`;
      lastEnd = end;
    });
    html += escapeHtml(previewRawText.slice(lastEnd));
    previewPre.innerHTML = html;

    document.getElementById(`pm-${previewMatchIdx}`)?.scrollIntoView({ block: "nearest" });
  }

  previewSearchInput.addEventListener("input", () => { previewMatchIdx = 0; applyPreviewSearch(); });
  prevMatchBtn.addEventListener("click", () => {
    const count = previewPre.querySelectorAll("mark").length;
    if (count === 0) return;
    previewMatchIdx = (previewMatchIdx - 1 + count) % count;
    applyPreviewSearch();
  });
  nextMatchBtn.addEventListener("click", () => {
    const count = previewPre.querySelectorAll("mark").length;
    if (count === 0) return;
    previewMatchIdx = (previewMatchIdx + 1) % count;
    applyPreviewSearch();
  });
  previewSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const count = previewPre.querySelectorAll("mark").length;
      if (count === 0) return;
      previewMatchIdx = e.shiftKey
        ? (previewMatchIdx - 1 + count) % count
        : (previewMatchIdx + 1) % count;
      applyPreviewSearch();
      e.preventDefault();
    }
  });

  // ── split layout ──────────────────────────────────────────────────────────
  const splitRow = document.createElement("div");
  splitRow.style.cssText = "display: flex; gap: 1rem; align-items: flex-start;";
  splitRow.appendChild(tableWrapper);
  splitRow.appendChild(previewPanel);

  recentSection.appendChild(filterRow);
  recentSection.appendChild(splitRow);
  root.appendChild(recentSection);

  // ── stream state ──────────────────────────────────────────────────────────
  let cachedStreams: StreamMeta[] = [];
  let currentSorted: StreamMeta[] = [];
  let selectedStreamId: string | null = null;

  const MOZILLA_PUSH_HOST = "push.services.mozilla.com";

  function activateStream(stream: StreamMeta) {
    selectedStreamId = stream.id;
    input.value = stream.id;
    for (const row of tbody.querySelectorAll<HTMLTableRowElement>("tr[data-sid]")) {
      row.style.background = row.dataset.sid === stream.id ? "var(--c-bg-subtle)" : "";
      row.style.boxShadow = row.dataset.sid === stream.id ? "inset 3px 0 0 var(--c-fg-default)" : "";
    }
    table.focus();
    previewRawText = "";
    previewMatchIdx = 0;
    previewPre.style.color = "var(--c-fg-subtle)";
    previewPre.textContent = "Loading…";
    fetchWsStream(sdk, stream).then((full) => {
      previewRawText = formatWsBundle(full);
      previewPre.style.color = "";
      applyPreviewSearch();
    }).catch((err) => {
      previewPre.style.color = "var(--c-fg-danger)";
      previewPre.textContent = `Failed to load stream: ${err}`;
    });
  }

  table.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (currentSorted.length === 0) return;
    const idx = selectedStreamId ? currentSorted.findIndex((s) => s.id === selectedStreamId) : -1;
    const next = e.key === "ArrowDown"
      ? Math.min(idx + 1, currentSorted.length - 1)
      : Math.max(idx - 1, 0);
    if (next === idx && idx !== -1) return;
    const target = currentSorted[next === -1 ? 0 : next];
    activateStream(target);
    tbody.querySelector<HTMLTableRowElement>(`tr[data-sid="${target.id}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function renderStreamList() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = cachedStreams.filter((s) => {
      if (radioHide.checked && s.host === MOZILLA_PUSH_HOST) return false;
      if (!query) return true;
      return s.id.toLowerCase().includes(query) ||
             s.host.toLowerCase().includes(query) ||
             s.path.toLowerCase().includes(query);
    });

    const sorted = [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortCol === "id") {
        const na = parseInt(a.id, 10);
        const nb = parseInt(b.id, 10);
        cmp = !isNaN(na) && !isNaN(nb) ? na - nb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      } else if (sortCol === "time") {
        cmp = a.createdAt.getTime() - b.createdAt.getTime();
      } else {
        const va = a[sortCol];
        const vb = b[sortCol];
        cmp = va < vb ? -1 : va > vb ? 1 : 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    currentSorted = sorted;
    updateSortIndicators();
    tbody.innerHTML = "";

    if (sorted.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.textContent = "No WebSocket streams found.";
      td.style.cssText = "padding: 0.5rem; opacity: 0.6;";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const stream of sorted) {
      const isSelected = stream.id === selectedStreamId;
      const tr = document.createElement("tr");
      tr.dataset.sid = stream.id;
      tr.style.cssText = "border-bottom: 1px solid var(--c-border-default); cursor: pointer;";
      if (isSelected) {
        tr.style.background = "var(--c-bg-subtle)";
        tr.style.boxShadow = "inset 3px 0 0 var(--c-fg-default)";
      }
      tr.addEventListener("mouseenter", () => {
        if (tr.dataset.sid !== selectedStreamId) tr.style.background = "var(--c-bg-subtle)";
      });
      tr.addEventListener("mouseleave", () => {
        if (tr.dataset.sid !== selectedStreamId) tr.style.background = "";
      });
      tr.addEventListener("click", () => activateStream(stream));

      const makeTd = (text: string): HTMLTableCellElement => {
        const td = document.createElement("td");
        td.style.cssText = "padding: 0.35rem 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
        td.textContent = text;
        td.title = text;
        return td;
      };

      const timeStr = stream.createdAt.toLocaleString(undefined, {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      });

      tr.appendChild(makeTd(stream.id));
      tr.appendChild(makeTd(timeStr));
      tr.appendChild(makeTd(stream.host));
      tr.appendChild(makeTd(stream.path || "/"));
      tbody.appendChild(tr);
    }
  }

  async function loadStreams() {
    tbody.innerHTML = "";
    const loadingTr = document.createElement("tr");
    const loadingTd = document.createElement("td");
    loadingTd.colSpan = 4;
    loadingTd.textContent = "Loading…";
    loadingTd.style.cssText = "padding: 0.5rem; opacity: 0.6;";
    loadingTr.appendChild(loadingTd);
    tbody.appendChild(loadingTr);
    try {
      cachedStreams = await fetchStreamList(sdk, 100000000);
      renderStreamList();
    } catch (err) {
      tbody.innerHTML = "";
      const errTr = document.createElement("tr");
      const errTd = document.createElement("td");
      errTd.colSpan = 4;
      errTd.textContent = `Failed to load streams: ${err}`;
      errTd.style.cssText = "padding: 0.5rem; color: var(--c-fg-danger);";
      errTr.appendChild(errTd);
      tbody.appendChild(errTr);
    }
  }

  radioHide.addEventListener("change", renderStreamList);
  searchInput.addEventListener("input", renderStreamList);

  return { body: root, onEnter: loadStreams };
}

// ─── Plugin Entry Point ───────────────────────────────────────────────────────

export function init(sdk: Caido): void {
  const { body, onEnter } = buildWsPage(sdk);

  sdk.navigation.addPage("/better-websockets", { body, onEnter });

  sdk.sidebar.registerItem("Better Websockets", "/better-websockets", {
    icon: "fas fa-plug",
    group: "Plugins",
  });
}
