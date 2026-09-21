/* OneDrive Personal metadata inventory. No third-party libraries or source writes. */
(function () {
  "use strict";
  const fields =
    "id,name,folder,file,package,size,createdDateTime,lastModifiedDateTime,specialFolder,remoteItem";
  const defaults = {
    maxItems: 1000000,
    maxRequests: 10000,
    maxMs: 15 * 60 * 1000,
  };
  const codeError = (code) => Object.assign(new Error(code), { code });
  const csvCell = (value) => {
    let s = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  function csv(report) {
    const columns = [
      "path",
      "type",
      "size",
      "modified",
      "created",
      "id",
      "coverage",
    ];
    return (
      "\ufeff" +
      [
        columns.join(","),
        ...report.items.map((x) => columns.map((k) => csvCell(x[k])).join(",")),
      ].join("\r\n")
    );
  }
  async function collect({
    base,
    origin,
    request,
    progress = () => {},
    signal,
    limits = {},
    now = Date.now,
  }) {
    const budget = { ...defaults, ...limits };
    for (const v of Object.values(budget))
      if (!Number.isSafeInteger(v) || v < 1) throw codeError("invalid_budget");
    const api = new URL(base, origin);
    if (
      api.origin !== origin ||
      !/^\/personal\/[a-f\d]+\/_api\/v2\.0\/drive$/i.test(api.pathname) ||
      api.search ||
      api.hash
    )
      throw codeError("invalid_api_base");
    const start = now();
    const report = {
      version: 1,
      started: new Date(start).toISOString(),
      finished: null,
      status: "running",
      scope: "Current ordinary items in My files, metadata only",
      limitations: [
        "Personal Vault is not covered; the listing API can omit it even when its tile is visible.",
        "Shared-with-me items outside My files, remote shortcut targets, recycle bin, version history and package internals are not covered.",
        "This is a live traversal, not an atomic point-in-time snapshot.",
      ],
      items: [],
      issues: [],
      requests: 0,
      foldersScanned: 0,
    };
    const seenItems = new Set();
    const pages = new Set();
    const queue = [{ id: null, path: "", expected: null, row: null }];
    const check = () => {
      if (signal?.aborted) throw codeError("cancelled");
      if (now() - start >= budget.maxMs) throw codeError("time_limit");
      if (report.requests >= budget.maxRequests)
        throw codeError("request_limit");
    };
    const issue = (path, code) => report.issues.push({ path, code });
    async function get(url, expectedPath) {
      check();
      const u = new URL(url, api.href + "/");
      const canonical = (p) =>
        decodeURIComponent(p).replace(
          /\/items\('([^']+)'\)\/children$/,
          "/items/$1/children",
        );
      const path = canonical(u.pathname);
      if (
        path !== canonical(expectedPath) ||
        u.origin !== origin ||
        u.username ||
        u.password ||
        u.hash ||
        !(
          path === api.pathname + "/root/children" ||
          (path.startsWith(api.pathname + "/items/") &&
            /^\/items\/[^/]+\/children$/.test(path.slice(api.pathname.length)))
        )
      )
        throw codeError("unsafe_next_link");
      if (pages.has(u.href)) throw codeError("pagination_loop");
      pages.add(u.href);
      for (let attempt = 0; attempt < 4; attempt++) {
        check();
        report.requests++;
        const r = await request(u.href, {
          signal,
          remainingMs: budget.maxMs - (now() - start),
        });
        if (r.status === 429 || r.status === 503) {
          if (attempt === 3) throw codeError("retry_limit_" + r.status);
          const wait = r.retryAfterMs ?? Math.min(1000 * 2 ** attempt, 10000);
          if (
            wait < 0 ||
            !Number.isFinite(wait) ||
            wait > 30000 ||
            now() - start + wait >= budget.maxMs
          )
            throw codeError("retry_budget");
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
        if (r.status !== 200) throw codeError("http_" + r.status);
        if (!Array.isArray(r.data?.value)) throw codeError("invalid_response");
        return r.data;
      }
    }
    let halted = false;
    for (let i = 0; i < queue.length && !halted; i++) {
      const folder = queue[i];
      let url =
        api.href +
        (folder.id === null
          ? "/root"
          : "/items/" + encodeURIComponent(folder.id)) +
        "/children?$top=200&$select=" +
        fields;
      const expectedPath = new URL(url).pathname;
      let count = 0;
      try {
        do {
          const data = await get(url, expectedPath);
          for (const item of data.value) {
            if (report.items.length >= budget.maxItems)
              throw codeError("item_limit");
            if (
              !item ||
              typeof item.id !== "string" ||
              !item.id ||
              typeof item.name !== "string" ||
              !item.name ||
              /[\/\u0000]/.test(item.name)
            )
              throw codeError("invalid_item");
            if (seenItems.has(item.id)) {
              issue(folder.path || "/", "duplicate_item");
              continue;
            }
            seenItems.add(item.id);
            count++;
            const path = folder.path + "/" + item.name;
            const remote = !!item.remoteItem;
            const vault = item.specialFolder?.name?.toLowerCase() === "vault";
            const isFolder =
              !!item.folder && !item.package && !remote && !vault;
            const row = {
              path,
              id: item.id,
              type: remote
                ? "shortcut"
                : vault
                  ? "vault"
                  : item.package
                    ? "package"
                    : item.folder
                      ? "folder"
                      : item.file
                        ? "file"
                        : "other",
              size:
                Number.isSafeInteger(item.size) && item.size >= 0
                  ? item.size
                  : null,
              modified:
                typeof item.lastModifiedDateTime === "string"
                  ? item.lastModifiedDateTime
                  : null,
              created:
                typeof item.createdDateTime === "string"
                  ? item.createdDateTime
                  : null,
              coverage: isFolder
                ? "pending"
                : remote || vault || item.package
                  ? "metadata_only"
                  : "listed",
            };
            report.items.push(row);
            if (isFolder)
              queue.push({
                id: item.id,
                path,
                row,
                expected: Number.isSafeInteger(item.folder.childCount)
                  ? item.folder.childCount
                  : null,
              });
            if (remote || vault || item.package || row.type === "other")
              issue(
                path,
                remote
                  ? "shortcut_target_not_scanned"
                  : vault
                    ? "vault_not_scanned"
                    : item.package
                      ? "package_internals_not_scanned"
                      : "unknown_item_type",
              );
          }
          url = data["@odata.nextLink"];
          if (url !== undefined && (typeof url !== "string" || !url))
            throw codeError("invalid_next_link");
          progress({
            items: report.items.length,
            foldersScanned: report.foldersScanned,
            requests: report.requests,
          });
        } while (url);
        if (folder.expected !== null && count !== folder.expected) {
          issue(folder.path, "child_count_mismatch");
          if (folder.row) folder.row.coverage = "count_mismatch";
        } else if (folder.row) folder.row.coverage = "scanned";
        report.foldersScanned++;
      } catch (e) {
        const code =
          e.code || (signal?.aborted ? "cancelled" : "request_failed");
        issue(folder.path || "/", code);
        if (folder.row) folder.row.coverage = "incomplete";
        halted =
          /limit|budget|cancelled|unsafe|invalid|pagination|request_failed|http_401/.test(
            code,
          );
      }
    }
    report.items.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    report.finished = new Date(now()).toISOString();
    report.status = report.issues.length
      ? "partial"
      : "ordinary_tree_enumerated";
    report.counts = report.items.reduce((a, x) => {
      a[x.type] = (a[x.type] || 0) + 1;
      return a;
    }, {});
    report.fileBytes = report.items
      .filter((x) => x.type === "file")
      .reduce((a, x) => a + (x.size || 0), 0);
    return report;
  }
  async function collectDelta({
    base,
    origin,
    request,
    progress = () => {},
    signal,
    limits = {},
    now = Date.now,
    resume = null,
  }) {
    const budget = { ...defaults, ...limits };
    const api = new URL(base, origin);
    if (
      api.origin !== origin ||
      !/^\/personal\/[a-f\d]+\/_api\/v2\.0\/drive$/i.test(api.pathname) ||
      api.search ||
      api.hash
    )
      throw codeError("invalid_api_base");
    for (const v of Object.values(budget))
      if (!Number.isSafeInteger(v) || v < 1) throw codeError("invalid_budget");
    const start = now(),
      records = new Map((resume?.items || []).map((x) => [x.id, { ...x }])),
      pages = new Set();
    const report = {
      version: 2,
      method: "delta",
      started: new Date(start).toISOString(),
      finished: null,
      status: "running",
      scope: "Current ordinary items in My files, metadata only",
      limitations: [
        "Personal Vault is not covered; the listing API can omit it even when its tile is visible.",
        "Shared-with-me items outside My files, remote shortcut targets, recycle bin, version history and package internals are not covered.",
        "The scan observes a live drive; recheck before downloading.",
      ],
      items: [],
      issues: [],
      requests: 0,
      foldersScanned: 0,
    };
    const check = () => {
      if (signal?.aborted) throw codeError("cancelled");
      if (now() - start >= budget.maxMs) throw codeError("time_limit");
      if (report.requests >= budget.maxRequests)
        throw codeError("request_limit");
    };
    async function get(value, root = false) {
      check();
      const u = new URL(value, api.href + "/");
      const suffix = decodeURIComponent(u.pathname).slice(api.pathname.length);
      if (
        u.origin !== origin ||
        u.username ||
        u.password ||
        u.hash ||
        !u.pathname.startsWith(api.pathname + "/") ||
        (root
          ? suffix !== "/root"
          : !["/root/delta", "/root/view.delta", "/delta"].includes(suffix))
      )
        throw codeError("unsafe_next_link");
      if (pages.has(u.href)) throw codeError("pagination_loop");
      pages.add(u.href);
      for (let attempt = 0; attempt < 4; attempt++) {
        check();
        report.requests++;
        const r = await request(u.href, {
          signal,
          remainingMs: budget.maxMs - (now() - start),
        });
        if ([429, 503].includes(r.status)) {
          if (attempt === 3) throw codeError("retry_limit_" + r.status);
          const delay = r.retryAfterMs ?? 1000 * 2 ** attempt;
          if (
            !Number.isFinite(delay) ||
            delay < 0 ||
            delay > 30000 ||
            now() - start + delay >= budget.maxMs
          )
            throw codeError("retry_budget");
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        if (r.status !== 200) throw codeError("http_" + r.status);
        return r.data;
      }
    }
    let rootId,
      terminal = false,
      pendingPage = resume?.pendingPage || null,
      url = resume?.nextUrl || null;
    try {
      const root = await get(api.href + "/root?$select=id", true);
      if (typeof root?.id !== "string" || !root.id)
        throw codeError("invalid_root");
      rootId = root.id;
      url ||=
        api.href +
        "/root/delta?$top=1000&$select=" +
        fields +
        ",parentReference,deleted,root";
      do {
        const data = pendingPage || (await get(url));
        pendingPage = data;
        if (!Array.isArray(data?.value)) throw codeError("invalid_response");
        for (const item of data.value) {
          if (typeof item?.id !== "string" || !item.id)
            throw codeError("invalid_item");
          if (item.deleted) {
            records.delete(item.id);
            continue;
          }
          if (item.id === rootId || item.root) continue;
          if (
            typeof item.name !== "string" ||
            !item.name ||
            /[\/\u0000]/.test(item.name)
          )
            throw codeError("invalid_item");
          if (records.size >= budget.maxItems && !records.has(item.id))
            throw codeError("item_limit");
          const remote = !!item.remoteItem,
            vault = item.specialFolder?.name === "vault";
          records.set(item.id, {
            id: item.id,
            parentId: item.parentReference?.id || null,
            name: item.name,
            type: remote
              ? "shortcut"
              : vault
                ? "vault"
                : item.package
                  ? "package"
                  : item.folder
                    ? "folder"
                    : item.file
                      ? "file"
                      : "other",
            size:
              Number.isSafeInteger(item.size) && item.size >= 0
                ? item.size
                : null,
            modified:
              typeof item.lastModifiedDateTime === "string"
                ? item.lastModifiedDateTime
                : null,
            created:
              typeof item.createdDateTime === "string"
                ? item.createdDateTime
                : null,
            expectedChildren: Number.isSafeInteger(item.folder?.childCount)
              ? item.folder.childCount
              : null,
          });
        }
        progress({
          items: records.size,
          foldersScanned: 0,
          requests: report.requests,
        });
        pendingPage = null;
        url = data["@odata.nextLink"];
        if (url !== undefined && (typeof url !== "string" || !url))
          throw codeError("invalid_next_link");
        if (!url) {
          if (
            typeof data["@odata.deltaLink"] !== "string" ||
            !data["@odata.deltaLink"]
          )
            throw codeError("no_terminal_link");
          terminal = true;
        }
      } while (url);
    } catch (e) {
      report.issues.push({
        path: "/",
        code: e.code || (signal?.aborted ? "cancelled" : "request_failed"),
      });
    }
    if (!terminal)
      Object.defineProperty(report, "checkpoint", {
        value: { items: [...records.values()], pendingPage, nextUrl: url },
        enumerable: false,
      });
    const resolved = new Map([[rootId, ""]]),
      childCounts = new Map();
    for (const row of records.values())
      childCounts.set(row.parentId, (childCounts.get(row.parentId) || 0) + 1);
    function resolve(row) {
      const chain = [],
        visited = new Set();
      let current = row;
      while (!resolved.has(current.id)) {
        if (visited.has(current.id)) throw codeError("parent_cycle");
        visited.add(current.id);
        chain.push(current);
        if (resolved.has(current.parentId)) break;
        current = records.get(current.parentId);
        if (!current) throw codeError("missing_parent");
      }
      for (let i = chain.length - 1; i >= 0; i--) {
        const x = chain[i];
        resolved.set(x.id, resolved.get(x.parentId) + "/" + x.name);
      }
      return resolved.get(row.id);
    }
    const paths = new Set();
    for (const row of records.values()) {
      try {
        row.path = resolve(row);
      } catch (e) {
        row.path = null;
        report.issues.push({ id: row.id, code: e.code });
      }
      row.coverage =
        row.type === "folder"
          ? terminal
            ? "scanned"
            : "incomplete"
          : row.type === "file"
            ? "listed"
            : "metadata_only";
      if (row.path && paths.has(row.path))
        report.issues.push({ path: row.path, code: "duplicate_path" });
      paths.add(row.path);
      if (
        terminal &&
        row.type === "folder" &&
        row.expectedChildren !== null &&
        row.expectedChildren !== (childCounts.get(row.id) || 0)
      ) {
        row.coverage = "count_mismatch";
        report.issues.push({ path: row.path, code: "child_count_mismatch" });
      }
      if (!["folder", "file"].includes(row.type))
        report.issues.push({
          path: row.path,
          code: row.type + "_internals_not_scanned",
        });
      report.items.push(row);
    }
    report.items.sort((a, b) => (a.path || a.id).localeCompare(b.path || b.id));
    report.finished = new Date(now()).toISOString();
    report.terminalReached = terminal;
    report.status = report.issues.length
      ? "partial"
      : "ordinary_tree_enumerated";
    report.counts = report.items.reduce((a, x) => {
      a[x.type] = (a[x.type] || 0) + 1;
      return a;
    }, {});
    report.fileBytes = report.items
      .filter((x) => x.type === "file")
      .reduce((a, x) => a + (x.size || 0), 0);
    report.foldersScanned = report.items.filter(
      (x) => x.type === "folder" && x.coverage === "scanned",
    ).length;
    return report;
  }
  const lib = { collect, collectDelta, csv, csvCell };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = lib;
    return;
  }
  window.__oneDriveInventoryLibrary = lib;
  if (location.origin !== "https://onedrive.live.com")
    throw codeError("open_onedrive_first");
  if (document.getElementById("od-inventory-tool")) {
    console.log("Inventory tool is already open.");
    return;
  }
  const resources = performance.getEntriesByType("resource");
  const candidate = resources
    .map((x) => new URL(x.name))
    .find(
      (u) =>
        u.origin === location.origin &&
        /^\/personal\/[a-f\d]+\/_api\//i.test(u.pathname),
    );
  if (!candidate)
    throw codeError("Open My files or a folder, then run this script again.");
  const base = candidate.pathname.split("/_api/")[0] + "/_api/v2.0/drive";
  const host = document.createElement("div");
  host.id = "od-inventory-tool";
  host.style.cssText =
    "position:fixed;inset:24px 24px auto auto;z-index:2147483647;width:min(540px,90vw)";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    ":host{font:15px system-ui;color:#172335}section{background:#fff;border:1px solid #bac8d8;border-radius:14px;padding:24px;box-shadow:0 12px 50px #0003}h2{margin:0 0 12px;font-size:23px}p{line-height:1.5}button{font:inherit;padding:9px 12px;margin:4px 5px 4px 0;border:1px solid #9caec3;background:#f4f7fa;border-radius:6px;cursor:pointer}button:disabled{opacity:.5;cursor:default}pre{max-height:180px;overflow:auto;white-space:pre-wrap;font:12px monospace}";
  shadow.append(style);
  const section = document.createElement("section");
  shadow.append(section);
  const el = (tag, text) => {
    const e = document.createElement(tag);
    e.textContent = text;
    section.append(e);
    return e;
  };
  el("h2", "OneDrive inventory");
  el(
    "p",
    "List the ordinary files and folders in My files. Reads metadata only. Personal Vault and shortcut targets are not covered.",
  );
  const status = el("p", "Ready. Exports stay on this computer.");
  status.setAttribute("role", "status");
  const run = el("button", "Scan OneDrive");
  const stop = el("button", "Stop");
  stop.disabled = true;
  const json = el("button", "Download JSON");
  const csvButton = el("button", "Download CSV");
  const tree = el("button", "Download file list");
  json.disabled = csvButton.disabled = tree.disabled = true;
  const close = el("button", "Close");
  const detail = el("pre", "");
  let controller, report, checkpoint;
  const download = (suffix, text, mime) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "onedrive-inventory-" +
      report.started.replace(/[:.]/g, "-") +
      "." +
      suffix;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  json.onclick = () =>
    download("json", JSON.stringify(report, null, 2), "application/json");
  csvButton.onclick = () =>
    download("csv", csv(report), "text/csv;charset=utf-8");
  tree.onclick = () =>
    download(
      "txt",
      [
        "OneDrive inventory — " + report.status,
        ...report.limitations,
        "",
        ...report.items.map((x) => "[" + x.type + "] " + x.path),
        "",
        "Issues:",
        ...report.issues.map((x) => x.code + ": " + x.path),
      ].join("\n"),
      "text/plain;charset=utf-8",
    );
  stop.onclick = () => controller?.abort();
  close.onclick = () => {
    controller?.abort();
    host.remove();
  };
  run.onclick = async () => {
    if (window.__oneDriveDiskBusy) return;
    window.__oneDriveInventoryScanning = true;
    run.disabled = true;
    stop.disabled = false;
    json.disabled = csvButton.disabled = tree.disabled = true;
    controller = new AbortController();
    detail.textContent = "";
    try {
      report = await collectDelta({
        base,
        origin: location.origin,
        resume: checkpoint,
        signal: controller.signal,
        progress: (p) => {
          status.textContent =
            p.items + " items listed · " + p.requests + " metadata requests";
        },
        request: async (url, { signal, remainingMs }) => {
          const r = await fetch(url, {
            method: "GET",
            credentials: "same-origin",
            redirect: "error",
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(Math.min(30000, Math.max(1, remainingMs))),
            ]),
            headers: { Accept: "application/json" },
          });
          const retry = r.headers.get("Retry-After");
          return {
            status: r.status,
            retryAfterMs:
              retry === null
                ? undefined
                : /^\d+$/.test(retry)
                  ? Number(retry) * 1000
                  : Math.max(0, Date.parse(retry) - Date.now()),
            data: r.status === 200 ? await r.json() : null,
          };
        },
      });
      checkpoint = report.checkpoint;
      run.textContent = checkpoint ? "Resume scan" : "Scan OneDrive";
      window.__oneDriveInventoryReport = report;
      status.textContent =
        (report.terminalReached ? "Folder scan finished" : "Partial scan") +
        ": " +
        (report.counts.file || 0) +
        " files, " +
        (report.counts.folder || 0) +
        " folders. Personal Vault not covered.";
      detail.textContent = JSON.stringify(
        {
          counts: report.counts,
          fileBytes: report.fileBytes,
          requests: report.requests,
          issues: report.issues.length,
        },
        null,
        2,
      );
      json.disabled = csvButton.disabled = tree.disabled = false;
    } catch (e) {
      status.textContent = "Scan stopped: " + (e.code || "unexpected_error");
    } finally {
      window.__oneDriveInventoryScanning = false;
      run.disabled = false;
      stop.disabled = true;
    }
  };
  document.documentElement.append(host);
  console.log(
    "OneDrive inventory tool ready. Close DevTools and click Scan OneDrive.",
  );
})();
