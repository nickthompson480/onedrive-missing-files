/* Fresh, sanitized metadata for offline timestamp restoration. */
(function () {
  "use strict";
  const sourceMetadata =
    typeof module !== "undefined" && module.exports
      ? require("./inventory.js").sourceMetadata
      : window.__oneDriveInventoryLibrary.sourceMetadata;
  const fail = (code) => Object.assign(new Error(code), { code });
  async function prepareMetadata({
    report,
    base,
    origin,
    request,
    signal,
    progress = () => {},
    now = Date.now,
    maxMs = 15 * 60 * 1000,
    maxRequests = 10000,
  }) {
    if (
      !report?.terminalReached ||
      !Array.isArray(report.items) ||
      !Array.isArray(report.issues) ||
      report.issues.some(
        (x) =>
          !/^(package|shortcut|vault|other)_internals_not_scanned$/.test(
            x.code,
          ),
      )
    )
      throw fail("finish_inventory_first");
    const api = new URL(base, origin);
    if (
      api.origin !== origin ||
      !/^\/personal\/[a-f\d]+\/_api\/v2\.0\/drive$/i.test(api.pathname) ||
      api.search ||
      api.hash
    )
      throw fail("invalid_api_base");
    for (const value of [maxMs, maxRequests])
      if (!Number.isSafeInteger(value) || value < 1)
        throw fail("invalid_budget");
    const started = now();
    let requests = 0,
      refreshed = 0;
    const total = report.items.filter((x) => x.type === "file").length;
    const items = report.items.map((x) => ({
      id: x.id,
      path: x.path,
      type: x.type,
      size: x.size,
      fileCreated: x.fileCreated ?? null,
      fileModified: x.fileModified ?? null,
      createdSource: x.createdSource ?? null,
      modifiedSource: x.modifiedSource ?? null,
      sha256: null,
      sha1: null,
      repairError: x.type === "file" ? "metadata_not_refreshed" : null,
    }));
    const result = {
      kind: "onedrive-date-repair",
      version: 1,
      prepared: new Date(started).toISOString(),
      inventoryStarted: report.started,
      terminalReached: true,
      limitations: report.limitations,
      items,
      metadataRefresh: {
        status: "running",
        requests: 0,
        refreshed: 0,
        issues: 0,
      },
    };
    function check() {
      if (signal?.aborted) throw fail("cancelled");
      if (now() - started >= maxMs) throw fail("time_limit");
      if (requests >= maxRequests) throw fail("request_limit");
    }
    for (let i = 0; i < items.length; i++) {
      const row = items[i],
        original = report.items[i];
      if (row.type !== "file") continue;
      try {
        let response;
        for (let attempt = 0; attempt < 4; attempt++) {
          check();
          requests++;
          response = await request(
            api.href + "/items/" + encodeURIComponent(row.id),
            { signal, remainingMs: maxMs - (now() - started) },
          );
          if (![429, 503].includes(response.status)) break;
          if (attempt === 3) throw fail("retry_limit");
          const delay = response.retryAfterMs ?? 1000 * 2 ** attempt;
          if (
            !Number.isFinite(delay) ||
            delay < 0 ||
            delay > 30000 ||
            now() - started + delay >= maxMs
          )
            throw fail("retry_budget");
          await new Promise((r) => setTimeout(r, delay));
        }
        if (response.status !== 200)
          throw fail("metadata_http_" + response.status);
        const meta = response.data;
        if (
          meta?.id !== row.id ||
          meta.name !== original.name ||
          meta.size !== row.size ||
          meta.parentReference?.id !== original.parentId ||
          !meta.file ||
          meta.folder ||
          meta.package ||
          meta.remoteItem
        )
          throw fail("remote_changed_rescan");
        Object.assign(row, sourceMetadata(meta));
        row.repairError =
          !row.fileCreated || !row.fileModified
            ? "source_dates_missing"
            : !row.sha256 && !row.sha1
              ? "cryptographic_hash_missing"
              : null;
        refreshed++;
      } catch (e) {
        row.repairError =
          (typeof e.code === "string" ? e.code : null) ||
          (signal?.aborted ? "cancelled" : "metadata_request_failed");
        if (/limit|budget|cancelled|http_401|http_403/.test(row.repairError))
          break;
      }
      progress({ refreshed, total, requests });
    }
    const issues = items.filter(
      (x) => x.type === "file" && x.repairError,
    ).length;
    result.metadataRefresh = {
      status: issues ? "partial" : "complete",
      requests,
      refreshed,
      issues,
    };
    return result;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { prepareMetadata };
    return;
  }
  const host = document.getElementById("od-inventory-tool");
  if (!host?.shadowRoot) return;
  const section = host.shadowRoot.querySelector("section");
  if (section.querySelector("[data-metadata]")) return;
  const block = document.createElement("div");
  block.dataset.metadata = "true";
  section.append(block);
  const el = (tag, text) => {
    const x = document.createElement(tag);
    x.textContent = text;
    block.append(x);
    return x;
  };
  el("h2", "Restore file dates");
  el(
    "p",
    "Browsers cannot set native file dates. Export fresh metadata, then run the included local repair tool after downloading. It also works on files downloaded earlier.",
  );
  const run = el("button", "Export date repair JSON"),
    stop = el("button", "Stop metadata export");
  stop.disabled = true;
  const status = el(
    "p",
    "Requires a finished inventory. File metadata is refreshed from OneDrive before export.",
  );
  status.setAttribute("role", "status");
  let controller;
  stop.onclick = () => controller?.abort();
  run.onclick = async () => {
    if (
      window.__oneDriveDiskBusy ||
      window.__oneDriveInventoryScanning ||
      window.__oneDriveMetadataBusy
    ) {
      status.textContent = "Wait for the current operation to finish.";
      return;
    }
    const controls = [...section.querySelectorAll("button")].map((x) => [
      x,
      x.disabled,
    ]);
    controls.forEach(([x]) => (x.disabled = true));
    stop.disabled = false;
    window.__oneDriveMetadataBusy = true;
    controller = new AbortController();
    try {
      const url = performance
        .getEntriesByType("resource")
        .map((x) => new URL(x.name))
        .find(
          (u) =>
            u.origin === location.origin &&
            /^\/personal\/[a-f\d]+\/_api\//i.test(u.pathname),
        );
      if (!url) throw fail("missing_api_base");
      const result = await prepareMetadata({
        report: window.__oneDriveInventoryReport,
        base: url.pathname.split("/_api/")[0] + "/_api/v2.0/drive",
        origin: location.origin,
        signal: controller.signal,
        progress: (p) =>
          (status.textContent =
            "Refreshed " + p.refreshed + " / " + p.total + " files…"),
        request: async (u, { signal, remainingMs }) => {
          const r = await fetch(u, {
            method: "GET",
            credentials: "same-origin",
            redirect: "error",
            headers: { Accept: "application/json" },
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(Math.min(30000, Math.max(1, remainingMs))),
            ]),
          });
          const retry = r.headers.get("Retry-After");
          return {
            status: r.status,
            data: r.status === 200 ? await r.json() : null,
            retryAfterMs:
              retry === null
                ? undefined
                : /^\d+$/.test(retry)
                  ? Number(retry) * 1000
                  : Math.max(0, Date.parse(retry) - Date.now()),
          };
        },
      });
      window.__oneDriveDateRepairManifest = result;
      const blob = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = blob;
      a.download = "onedrive-date-repair.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(blob), 10000);
      status.textContent =
        "Exported: " +
        result.metadataRefresh.refreshed +
        " files refreshed; " +
        result.metadataRefresh.issues +
        " skipped or unrefreshed. Run repair-dates.py locally in preview mode first.";
    } catch (e) {
      status.textContent =
        "Metadata export stopped: " + (e.code || "unexpected_error");
    } finally {
      controls.forEach(([x, disabled]) => (x.disabled = disabled));
      stop.disabled = true;
      window.__oneDriveMetadataBusy = false;
    }
  };
})();
