/* In-memory progress and bounded, text-only issue views. */
(function () {
  "use strict";
  const bytes = (n) => {
    if (!Number.isFinite(n)) return "Unknown size";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return n.toFixed(i ? 1 : 0) + " " + units[i];
  };
  function advice(code) {
    if (/size_mismatch|existing_file_preserved/.test(code))
      return "Existing contents are preserved. Compare the local and OneDrive copies before making changes.";
    if (/collision|duplicate_path|incompatible_path|invalid_path/.test(code))
      return "Resolve the name or path conflict, then scan and check disk again.";
    if (/NotAllowed|permission|access/i.test(code))
      return "Choose the folder again and grant access, then check disk.";
    if (/Quota|space/.test(code))
      return "Free disk space, then check disk again.";
    if (/remote_changed|identity/.test(code))
      return "Scan OneDrive again, then check disk.";
    if (/cancel|limit|budget/.test(code))
      return "Check disk again to continue missing downloads. Resume a partial date export from its button.";
    if (/hash|dates_missing|metadata_not_refreshed/.test(code))
      return "Refresh the date repair export. The helper skips files without usable metadata.";
    if (/unsupported|internals_not_scanned/.test(code))
      return "This item is outside the tool's supported coverage; review it separately in OneDrive.";
    return "Review this item, then retry the relevant scan or disk check. No automatic overwrite is offered.";
  }
  function collectIssues({ inventory, plan, result, metadata }) {
    const rows = [];
    const add = (source, row, code) =>
      rows.push({
        source,
        path: row.path || row.id || "Entire operation",
        code: String(code),
        localSize: row.localSize,
        size: row.size,
      });
    for (const x of inventory?.issues || []) add("Inventory", x, x.code);
    for (const x of plan?.items || [])
      if (
        ["conflict", "existing_size_mismatch", "unsupported"].includes(x.status)
      )
        add("Disk", x, x.reason || x.status);
    for (const x of result?.issues || []) add("Download", x, x.code);
    for (const x of metadata?.items || [])
      if (x.repairError) add("Date repair", x, x.repairError);
    return rows;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { bytes, advice, collectIssues };
    return;
  }
  const host = document.getElementById("od-inventory-tool");
  const section = host?.shadowRoot?.querySelector("section");
  if (!section || section.querySelector("[role=tablist]")) return;
  const make = (tag, text, parent) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const style = make("style", null, host.shadowRoot);
  style.textContent =
    "[hidden]{display:none!important}[role=tablist]{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}[role=tab][aria-selected=true]{background:#165baa;color:white;border-color:#165baa}.od-card{border:1px solid #d3dce6;border-radius:8px;padding:12px;margin:10px 0;overflow-wrap:anywhere}.od-path{font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}progress{width:100%;height:14px}input,select{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}.od-muted{color:#526071;font-size:13px}.od-list{max-height:360px;overflow:auto}h3{font-size:16px;margin:8px 0}";
  const workflow = make("div");
  while (section.firstChild) workflow.append(section.firstChild);
  const tabs = make("div", null, section);
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "OneDrive tool views");
  section.append(workflow);
  const activity = make("div", null, section),
    issues = make("div", null, section);
  const panels = [workflow, activity, issues],
    buttons = [];
  function select(index) {
    panels.forEach((p, i) => {
      p.hidden = i !== index;
      buttons[i].setAttribute("aria-selected", String(i === index));
      buttons[i].tabIndex = i === index ? 0 : -1;
    });
    if (index === 2) renderIssues();
  }
  ["Files & dates", "Activity", "Issues"].forEach((name, i) => {
    const b = make("button", name, tabs);
    b.dataset.navigation = "true";
    b.id = "od-tab-" + i;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", "od-panel-" + i);
    panels[i].id = "od-panel-" + i;
    panels[i].setAttribute("role", "tabpanel");
    panels[i].setAttribute("aria-labelledby", b.id);
    b.onclick = () => select(i);
    b.onkeydown = (e) => {
      let next;
      if (e.key === "ArrowRight") next = (i + 1) % 3;
      if (e.key === "ArrowLeft") next = (i + 2) % 3;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = 2;
      if (next !== undefined) {
        e.preventDefault();
        select(next);
        buttons[next].focus();
      }
    };
    buttons.push(b);
  });
  const current = make("div", null, section);
  current.className = "od-card";
  section.insertBefore(current, workflow);
  const stage = make("h3", "No download running", current);
  const path = make("div", "Start a download from Files & dates.", current);
  path.className = "od-path";
  const meter = make("progress", null, current);
  meter.max = 100;
  meter.value = 0;
  meter.setAttribute("aria-label", "Current file download progress");
  const info = make("p", "", current);
  info.className = "od-muted";
  const transfers = make("div", null, current);
  transfers.className = "od-list";
  const active = new Map();
  const halt = make("button", "Stop downloads", current);
  halt.dataset.navigation = "true";
  halt.disabled = true;
  const originalStop = [...workflow.querySelectorAll("button")].find(
    (b) => b.textContent === "Stop downloads",
  );
  halt.onclick = () => originalStop?.click();
  make("h2", "Download activity", activity);
  make(
    "p",
    "Latest 200 completed, skipped, or failed items in this panel session. Save the disk report for the full download result.",
    activity,
  );
  const history = make("div", null, activity);
  history.className = "od-list";
  make("h2", "Issues & conflicts", issues);
  const summary = make("p", "", issues);
  summary.setAttribute("role", "status");
  const search = make("input", null, issues);
  search.type = "search";
  search.placeholder = "Filter by path or reason";
  search.setAttribute("aria-label", "Filter issues by path or reason");
  const filter = make("select", null, issues);
  filter.setAttribute("aria-label", "Issue source");
  ["All sources", "Inventory", "Disk", "Download", "Date repair"].forEach(
    (s) => {
      const o = make("option", s, filter);
      o.value = s;
    },
  );
  const list = make("div", null, issues);
  list.className = "od-list";
  const previous = make("button", "Previous", issues),
    next = make("button", "Next", issues);
  previous.dataset.navigation = next.dataset.navigation = "true";
  let page = 0,
    cachedRefs = [],
    allIssues = [],
    activeIssues = [],
    latest;
  function renderIssues(force = true) {
    const refs = [
      window.__oneDriveInventoryReport,
      window.__oneDriveDiskPlan,
      window.__oneDriveDownloadResult,
      window.__oneDriveDateRepairManifest,
    ];
    const changed = refs.some((r, i) => r !== cachedRefs[i]);
    if (!force && !changed) return;
    if (changed) {
      allIssues = collectIssues({
        inventory: refs[0],
        plan: refs[1],
        result: refs[2],
        metadata: refs[3],
      });
      cachedRefs = refs;
    }
    const combined = [
      ...allIssues,
      ...activeIssues.filter(
        (x) =>
          !allIssues.some(
            (y) =>
              y.source === x.source && y.path === x.path && y.code === x.code,
          ),
      ),
    ];
    buttons[2].textContent = "Issues (" + combined.length + ")";
    const query = search.value.toLowerCase();
    const found = combined.filter(
      (x) =>
        (filter.value === "All sources" || x.source === filter.value) &&
        (x.path + " " + x.code).toLowerCase().includes(query),
    );
    page = Math.min(page, Math.max(0, Math.ceil(found.length / 50) - 1));
    summary.textContent = found.length
      ? `${found.length} matching issues | ${page * 50 + 1}-${Math.min(found.length, (page + 1) * 50)} shown`
      : "No issues reported for this filter. Run a scan and disk check to assess files.";
    list.replaceChildren();
    for (const x of found.slice(page * 50, (page + 1) * 50)) {
      const card = make("div", null, list);
      card.className = "od-card";
      make("div", x.path, card).className = "od-path";
      make("p", x.source + " | " + x.code.replaceAll("_", " "), card);
      if (x.localSize !== undefined)
        make(
          "p",
          "Local: " + bytes(x.localSize) + " | OneDrive: " + bytes(x.size),
          card,
        );
      make("p", advice(x.code), card).className = "od-muted";
    }
    previous.disabled = page === 0;
    next.disabled = (page + 1) * 50 >= found.length;
  }
  search.oninput = filter.onchange = () => {
    page = 0;
    renderIssues();
  };
  previous.onclick = () => {
    page--;
    renderIssues();
  };
  next.onclick = () => {
    page++;
    renderIssues();
  };
  window.__oneDriveActivity = (entry) => {
    if (entry.reset) {
      activeIssues = [];
      active.clear();
      latest = null;
      path.textContent = "Preparing the next download…";
      info.textContent = "";
      meter.value = 0;
    }
    if (entry.path) latest = entry;
    if (
      entry.path &&
      [
        "Checking destination",
        "Requesting file",
        "Downloading",
        "Saving file",
      ].includes(entry.stage)
    )
      active.set(entry.path, entry);
    else if (entry.path) active.delete(entry.path);
    if (entry.finished) active.clear();
    transfers.replaceChildren();
    for (const item of active.values()) {
      const card = make("div", null, transfers);
      card.className = "od-card";
      make("div", item.path, card).className = "od-path";
      make("div", item.stage, card);
      const bar = make("progress", null, card);
      bar.max = 100;
      bar.value = item.size ? Math.min(100, (item.bytes / item.size) * 100) : 0;
      bar.setAttribute("aria-label", "Download progress: " + item.path);
      make(
        "p",
        `${bytes(item.bytes)} / ${bytes(item.size)} | ${Math.round(bar.value)}% | ${bytes(item.elapsedMs > 0 ? item.bytes / (item.elapsedMs / 1000) : 0)}/s average`,
        card,
      ).className = "od-muted";
    }
    path.hidden = meter.hidden = info.hidden = active.size > 0;
    stage.textContent = active.size
      ? `${active.size} active downloads | ${entry.completed} / ${entry.total} files completed`
      : entry.stage;
    halt.disabled = !!entry.finished;
    if (latest) {
      path.textContent = latest.path;
      meter.value = latest.size
        ? Math.min(100, (latest.bytes / latest.size) * 100)
        : latest.stage === "Downloaded"
          ? 100
          : 0;
      info.textContent = `${bytes(latest.bytes)} / ${bytes(latest.size)} | ${Math.round(meter.value)}% | ${bytes(latest.elapsedMs > 0 ? latest.bytes / (latest.elapsedMs / 1000) : 0)}/s average | ${latest.completed} / ${latest.total} files completed`;
    }
    if (
      ["Downloaded", "Skipped", "Issue", "Folder created"].includes(entry.stage)
    ) {
      const card = make("div");
      card.className = "od-card";
      make("div", entry.path || "Download operation", card).className =
        "od-path";
      make(
        "p",
        new Date().toLocaleTimeString() +
          " | " +
          entry.stage +
          (entry.code ? " | " + String(entry.code).replaceAll("_", " ") : ""),
        card,
      );
      history.prepend(card);
      while (history.children.length > 200) history.lastChild.remove();
      if (entry.stage === "Issue")
        activeIssues.push({
          source: "Download",
          path: entry.path || "Entire operation",
          code: String(entry.code),
        });
      renderIssues();
    }
  };
  select(0);
  const timer = setInterval(() => {
    if (!host.isConnected) {
      clearInterval(timer);
      return;
    }
    renderIssues(false);
  }, 1500);
})();
