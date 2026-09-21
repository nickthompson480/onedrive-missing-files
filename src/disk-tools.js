/* Local-only disk comparison and missing-file downloads for Chromium browsers. */
(function () {
  "use strict";
  const fail = (code) => Object.assign(new Error(code), { code });
  const stop = (signal) => {
    if (signal?.aborted) throw fail("cancelled");
  };
  function parts(path) {
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//")
    )
      throw fail("invalid_path");
    const result = path.slice(1).split("/");
    for (const part of result) {
      if (
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"\\|?*\u0000-\u001f]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) ||
        part.length > 255
      )
        throw fail("windows_incompatible_path");
    }
    return result;
  }
  const key = (path) => path.normalize("NFC").toLowerCase();
  function validateInventory(report) {
    if (!report || !Array.isArray(report.items) || !report.terminalReached)
      throw fail("finish_inventory_first");
    const blocking = report.issues.filter(
      (x) =>
        !/^(package|shortcut|vault|other)_internals_not_scanned$/.test(x.code),
    );
    if (blocking.length) throw fail("inventory_has_unresolved_errors");
  }
  // Keep only controlled operation names and relative paths; never raw messages/URLs.
  async function operation(step, path, action) {
    try {
      return await action();
    } catch (e) {
      const name = e.name || "Error";
      let code = typeof e.code === "string" ? e.code : name;
      if (
        name === "TypeError" &&
        /^(open|create)_local_(file|folder)$/.test(step)
      )
        code = /\.(lnk|url|scf|ini)$/i.test(path)
          ? "browser_restricted_file_type"
          : "browser_rejected_name";
      throw Object.assign(fail(code), {
        name,
        operation: step,
        localPath: path,
      });
    }
  }
  function filesystem(root) {
    const cache = new Map([["", root]]);
    async function directory(segments, create = false, fresh = false) {
      let handle = root,
        prefix = "";
      for (const name of segments) {
        prefix += "/" + name;
        if (!fresh && cache.has(prefix) && (cache.get(prefix) || !create))
          handle = cache.get(prefix);
        else if (handle) {
          try {
            handle = await operation(
              create ? "create_local_folder" : "open_local_folder",
              prefix,
              () => handle.getDirectoryHandle(name, { create }),
            );
          } catch (e) {
            if (e.name === "NotFoundError" && !create) handle = null;
            else throw e;
          }
          cache.set(prefix, handle);
        }
        if (!handle) return null;
      }
      return handle;
    }
    async function inspect(segments, type, fresh = false) {
      const parent = await directory(segments.slice(0, -1), false, fresh);
      if (!parent) return { status: "missing" };
      const path = "/" + segments.join("/");
      let handle;
      try {
        if (type === "folder") {
          await operation("open_local_folder", path, () =>
            parent.getDirectoryHandle(segments.at(-1)),
          );
          return { status: "present" };
        }
        handle = await operation("open_local_file", path, () =>
          parent.getFileHandle(segments.at(-1)),
        );
      } catch (e) {
        if (e.name === "NotFoundError") return { status: "missing" };
        throw e;
      }
      // A handle that disappears during getFile is an access failure, not proof of absence.
      const file = await operation("read_local_file", path, () =>
        handle.getFile(),
      );
      return { status: "present", size: file.size };
    }
    return { directory, inspect };
  }
  async function checkDisk({ report, root, signal, progress = () => {} }) {
    validateInventory(report);
    const fs = filesystem(root),
      plan = {
        version: 1,
        inventoryStarted: report.started,
        folder: root.name,
        checked: new Date().toISOString(),
        items: [],
        counts: {},
        missingBytes: 0,
        status: "checking",
      };
    const occurrences = new Map();
    for (const x of report.items)
      if (x.path)
        occurrences.set(key(x.path), (occurrences.get(key(x.path)) || 0) + 1);
    const collisions = [...occurrences]
      .filter(([, n]) => n > 1)
      .map(([k]) => k);
    for (const x of report.items) {
      stop(signal);
      const row = {
        id: x.id,
        path: x.path,
        type: x.type,
        size: x.size,
        modified: x.modified,
        parentId: x.parentId,
        name: x.name,
      };
      try {
        const segments = parts(x.path);
        if (
          collisions.some(
            (k) => key(x.path) === k || key(x.path).startsWith(k + "/"),
          )
        )
          throw fail("case_or_unicode_collision");
        if (!["file", "folder"].includes(x.type)) row.status = "unsupported";
        else if (
          x.type === "file" &&
          (!Number.isSafeInteger(x.size) || x.size < 0)
        )
          throw fail("unknown_remote_size");
        else {
          const local = await fs.inspect(segments, x.type);
          row.status = local.status;
          if (local.status === "present" && x.type === "file") {
            row.localSize = local.size;
            if (local.size !== x.size) {
              row.status = "existing_size_mismatch";
              if (local.size === 0) row.reason = "empty_local_file";
            }
          }
        }
      } catch (e) {
        row.status = "conflict";
        row.reason =
          typeof e.code === "string" ? e.code : e.name || "local_access_error";
        row.operation = e.operation;
        row.localPath = e.localPath;
      }
      plan.items.push(row);
      plan.counts[row.status] = (plan.counts[row.status] || 0) + 1;
      if (row.status === "missing" && row.type === "file")
        plan.missingBytes += row.size;
      if (plan.items.length % 100 === 0) {
        progress({ checked: plan.items.length, total: report.items.length });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    plan.status = "checked";
    return plan;
  }
  function samplePlan(plan) {
    if (plan?.status !== "checked") throw fail("check_disk_first");
    const candidates = plan.items.filter(
      (x) =>
        x.status === "missing" &&
        x.type === "file" &&
        x.size > 0 &&
        x.size <= 1024 ** 2,
    );
    const meaningful = candidates.filter((x) => x.size >= 16 * 1024);
    const items = [
      ...meaningful,
      ...candidates.filter((x) => x.size < 16 * 1024),
    ].slice(0, 3);
    return {
      ...plan,
      items,
      missingBytes: items.reduce((n, x) => n + x.size, 0),
      counts: { missing: items.length },
      scope: "small_file_test",
    };
  }
  async function recoveryPlan({ plan, report, originalRoot, root, signal }) {
    validateInventory(report);
    if (plan?.status !== "checked" || plan.inventoryStarted !== report.started)
      throw fail("check_disk_first");
    if (
      (await originalRoot.resolve(root)) !== null ||
      (await root.resolve(originalRoot)) !== null
    )
      throw fail("choose_separate_recovery_folder");
    const selected = new Set(
      plan.items
        .filter(
          (x) => x.status === "existing_size_mismatch" && x.type === "file",
        )
        .map((x) => x.id),
    );
    if (!selected.size) throw fail("no_size_mismatches");
    return checkDisk({
      report: {
        ...report,
        items: report.items.filter((x) => selected.has(x.id)),
      },
      root,
      signal,
    });
  }
  async function populate({
    plan,
    root,
    fetchFile,
    signal,
    progress = () => {},
    activity = () => {},
    concurrency = 1,
    maxFiles = 10000,
    maxBytes = 5 * 1024 ** 3,
    maxMs = 60 * 60 * 1000,
  }) {
    if (plan?.status !== "checked") throw fail("check_disk_first");
    for (const n of [maxFiles, maxBytes, maxMs])
      if (!Number.isSafeInteger(n) || n < 1) throw fail("invalid_budget");
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5)
      throw fail("invalid_concurrency");
    const start = Date.now(),
      fs = filesystem(root);
    const result = {
      started: new Date(start).toISOString(),
      folder: root.name,
      downloaded: 0,
      foldersCreated: 0,
      bytes: 0,
      skipped: 0,
      issues: [],
      files: [],
      status: "running",
    };
    const missing = plan.items
      .filter((x) => x.status === "missing")
      .sort(
        (a, b) =>
          a.path.split("/").length - b.path.split("/").length ||
          a.path.localeCompare(b.path),
      );
    const totalFiles = missing.filter((x) => x.type === "file").length;
    const seen = new Set();
    for (const row of missing) {
      const normalized = key(row.path);
      if (seen.has(normalized)) throw fail("duplicate_download_path");
      seen.add(normalized);
    }
    const runController = new AbortController();
    const runSignal = signal
      ? AbortSignal.any([signal, runController.signal])
      : runController.signal;
    let halted = false,
      reservedBytes = 0,
      reservedFiles = 0;
    const timer = setTimeout(
      () => runController.abort(fail("time_limit")),
      maxMs,
    );
    const checkStop = () => {
      if (runSignal.aborted)
        throw fail(
          runSignal.reason?.code === "time_limit" ? "time_limit" : "cancelled",
        );
      if (Date.now() - start >= maxMs) throw fail("time_limit");
    };
    result.concurrency = concurrency;
    async function processRow(row) {
      let reserved = false;
      let writable,
        response,
        step = "check_destination";
      const fileStarted = Date.now();
      let fileBytes = 0,
        lastUpdate = 0;
      const update = (stage, force = true, code = null) => {
        const now = Date.now();
        if (!force && now - lastUpdate < 200) return;
        lastUpdate = now;
        activity({
          path: row.path,
          type: row.type,
          size: row.size,
          bytes: fileBytes,
          stage,
          code,
          operation: step,
          elapsedMs: now - fileStarted,
          completed: result.downloaded,
          total: totalFiles,
        });
      };
      update(
        row.type === "folder" ? "Creating folder" : "Checking destination",
      );
      try {
        checkStop();
        const segments = parts(row.path);
        const local = await fs.inspect(segments, row.type, true);
        checkStop();
        if (halted) return;
        if (local.status !== "missing") {
          result.skipped++;
          update("Skipped", true, "existing_file_preserved");
          return;
        }
        if (row.type === "folder") {
          await fs.directory(segments, true, true);
          result.foldersCreated++;
          update("Folder created");
          if (result.foldersCreated % 100 === 0) {
            progress({
              downloaded: result.downloaded,
              bytes: result.bytes,
              foldersCreated: result.foldersCreated,
              errors: result.issues.length,
            });
            await new Promise((r) => setTimeout(r, 0));
          }
          return;
        }
        if (row.type !== "file") throw fail("unsupported_type");
        if (!Number.isSafeInteger(row.size) || row.size < 0)
          throw fail("unknown_remote_size");
        if (
          result.downloaded + reservedFiles >= maxFiles ||
          result.bytes + reservedBytes + row.size > maxBytes
        )
          throw fail("download_budget");
        reservedBytes += row.size;
        reservedFiles++;
        reserved = true;
        update("Requesting file");
        step = "request_file";
        response = await fetchFile(row, runSignal, (value) => {
          step = value;
        });
        if (!response?.body) throw fail("missing_download_stream");
        // Recheck after the network request; never intentionally replace an existing file.
        if ((await fs.inspect(segments, "file", true)).status !== "missing") {
          await response.body.cancel();
          result.skipped++;
          update("Skipped", true, "existing_file_preserved");
          return;
        }
        checkStop();
        const parent = await fs.directory(segments.slice(0, -1), true, true);
        step = "create_local_file";
        const handle = await operation(step, row.path, () =>
          parent.getFileHandle(segments.at(-1), { create: true }),
        );
        // A competing writer may have created a nonempty file between lookup and creation.
        if (
          (await operation("read_local_file", row.path, () => handle.getFile()))
            .size !== 0
        ) {
          await response.body.cancel();
          result.skipped++;
          update("Skipped", true, "existing_file_preserved");
          return;
        }
        checkStop();
        step = "open_write_stream";
        writable = await operation(step, row.path, () =>
          handle.createWritable({ keepExistingData: false, mode: "exclusive" }),
        );
        const reader = response.body.getReader();
        let bytes = 0;
        const abortRead = () => {
          reader.cancel().catch(() => {});
        };
        runSignal.addEventListener("abort", abortRead, { once: true });
        try {
          while (true) {
            checkStop();
            step = "read_download_stream";
            const { done, value } = await reader.read();
            checkStop();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > row.size || result.bytes + bytes > maxBytes)
              throw fail("download_size_mismatch");
            step = "write_local_file";
            await writable.write(value);
            const firstChunk = fileBytes === 0;
            fileBytes = bytes;
            update("Downloading", firstChunk);
          }
          if (bytes !== row.size) throw fail("download_size_mismatch");
          checkStop();
          update("Saving file");
          step = "save_local_file";
          await writable.close();
          writable = null;
          step = "verify_local_file";
          if ((await handle.getFile()).size !== row.size)
            throw fail("local_size_mismatch");
          reservedBytes -= row.size;
          reservedFiles--;
          reserved = false;
          result.downloaded++;
          result.bytes += bytes;
          result.files.push({ path: row.path, bytes, status: "downloaded" });
          update("Downloaded");
        } finally {
          runSignal.removeEventListener("abort", abortRead);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch (e) {
        const code =
          (runSignal.aborted
            ? runSignal.reason?.code === "time_limit"
              ? "time_limit"
              : "cancelled"
            : null) ||
          (typeof e.code === "string" ? e.code : e.name || "download_failed");
        if (/limit|budget|cancelled|QuotaExceeded|NotAllowed/.test(code)) {
          halted = true;
          if (code !== "download_budget") runController.abort(fail(code));
        }
        if (writable) await writable.abort().catch(() => {});
        step = e.operation || step;
        result.issues.push({
          path: row.path,
          code,
          operation: step,
          localPath: e.localPath,
          size: row.size,
          bytes: fileBytes,
        });
        update("Issue", true, code);
        // Preserve any empty placeholder; report it on the next disk check.
      } finally {
        if (response?.body && !response.body.locked)
          await response.body.cancel().catch(() => {});
        if (reserved) {
          reservedBytes -= row.size;
          reservedFiles--;
        }
      }
      progress({
        downloaded: result.downloaded,
        bytes: result.bytes,
        foldersCreated: result.foldersCreated,
        errors: result.issues.length,
      });
    }
    try {
      // Prepare folders in order before independent file workers begin.
      for (const row of missing.filter((x) => x.type === "folder")) {
        if (halted) break;
        await processRow(row);
      }
      const queue = missing.filter((x) => x.type !== "folder");
      let next = 0;
      const worker = async () => {
        while (!halted && next < queue.length) {
          const row = queue[next++];
          await processRow(row);
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      clearTimeout(timer);
    }
    result.finished = new Date().toISOString();
    result.status = result.issues.length ? "partial" : "finished";
    return result;
  }
  const api = {
    parts,
    checkDisk,
    populate,
    validateInventory,
    samplePlan,
    recoveryPlan,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  const host = document.getElementById("od-inventory-tool");
  if (!host?.shadowRoot || !window.showDirectoryPicker)
    throw fail("open_inventory_in_desktop_chrome_or_edge");
  const section = host.shadowRoot.querySelector("section");
  if (section.querySelector("[data-disk]")) return;
  const block = document.createElement("div");
  block.dataset.disk = "true";
  section.append(block);
  host.style.maxHeight = "90vh";
  host.style.overflow = "auto";
  const el = (tag, text) => {
    const e = document.createElement(tag);
    e.textContent = text;
    block.append(e);
    return e;
  };
  el("h2", "Fill missing files");
  el(
    "p",
    "Choose the local folder that corresponds to My files. Existing files stay unchanged, including size mismatches. Keep the folder idle while downloading.",
  );
  const status = el("p", "No folder selected.");
  status.setAttribute("role", "status");
  const choose = el("button", "Choose local folder"),
    check = el("button", "Check disk"),
    download = el("button", "Download missing"),
    test = el("button", "Test 3 small files"),
    cancel = el("button", "Stop downloads"),
    save = el("button", "Save disk report"),
    recover = el("button", "Copy size mismatches elsewhere");
  el(
    "p",
    "For empty or differing local files, copy the OneDrive versions to a separate folder for review. Originals stay unchanged.",
  );
  check.disabled =
    download.disabled =
    test.disabled =
    cancel.disabled =
    save.disabled =
    recover.disabled =
      true;
  const concurrencyLabel = el("label", "Parallel downloads ");
  const parallel = document.createElement("select");
  parallel.setAttribute("aria-label", "Parallel downloads");
  for (let n = 1; n <= 5; n++) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = String(n);
    parallel.append(option);
  }
  parallel.value = "3";
  concurrencyLabel.append(parallel);
  const detail = el("pre", "");
  let root, plan, result, controller, inventory;
  const scanButton = [...section.querySelectorAll("button")].find(
    (x) => x.textContent === "Scan OneDrive",
  );
  const closeButton = [...section.querySelectorAll("button")].find(
    (x) => x.textContent === "Close",
  );
  const controls = [choose, check, download, test, parallel, recover];
  const busy = (value) => {
    window.__oneDriveDiskBusy = value;
    controls.forEach((x) => (x.disabled = value));
    scanButton.disabled = value;
    closeButton.disabled = value;
    cancel.disabled = !value;
    if (!value)
      recover.disabled = !plan?.items.some(
        (x) => x.status === "existing_size_mismatch",
      );
  };
  const endpoint = () => {
    const found = performance
      .getEntriesByType("resource")
      .map((x) => new URL(x.name))
      .find(
        (u) =>
          u.origin === location.origin &&
          /^\/personal\/[a-f\d]+\/_api\//i.test(u.pathname),
      );
    if (!found) throw fail("missing_api_base");
    return found.pathname.split("/_api/")[0] + "/_api/v2.0/drive";
  };
  choose.onclick = async () => {
    try {
      root = await showDirectoryPicker({
        id: "onedrive-missing-files",
        mode: "readwrite",
      });
      plan = null;
      window.__oneDriveDiskPlan = null;
      window.__oneDriveDownloadResult = null;
      window.__oneDriveRecoveryPlan = null;
      window.__oneDriveActivity?.({ clearIssues: true });
      download.disabled = test.disabled = recover.disabled = true;
      check.disabled = false;
      status.textContent = "Selected: " + root.name + ". Click Check disk.";
    } catch (e) {
      status.textContent =
        e.name === "AbortError"
          ? "Folder selection cancelled."
          : "Folder access was not granted.";
    }
  };
  check.onclick = async () => {
    if (window.__oneDriveInventoryScanning || window.__oneDriveMetadataBusy) {
      status.textContent = "Wait for the inventory scan to finish.";
      return;
    }
    busy(true);
    controller = new AbortController();
    plan = null;
    result = null;
    window.__oneDriveDiskPlan = null;
    window.__oneDriveDownloadResult = null;
    window.__oneDriveRecoveryPlan = null;
    window.__oneDriveActivity?.({ clearIssues: true });
    try {
      inventory = window.__oneDriveInventoryReport;
      plan = await checkDisk({
        report: inventory,
        root,
        signal: controller.signal,
        progress: (p) =>
          (status.textContent =
            "Checking " + p.checked + " / " + p.total + " items…"),
      });
      window.__oneDriveDiskPlan = plan;
      const missingFiles = plan.items.filter(
        (x) => x.status === "missing" && x.type === "file",
      ).length;
      status.textContent =
        missingFiles +
        " missing files · " +
        (plan.missingBytes / 1024 ** 2).toFixed(1) +
        " MB to download. Existing files will be kept.";
      detail.textContent = JSON.stringify(plan.counts, null, 2);
      save.disabled = false;
    } catch (e) {
      status.textContent = "Disk check stopped: " + (e.code || e.name);
    } finally {
      busy(false);
      download.disabled = test.disabled = !plan;
    }
  };
  const startDownload = async (sample = false, recovery = false) => {
    if (window.__oneDriveInventoryScanning || window.__oneDriveMetadataBusy) {
      status.textContent = "Wait for the inventory scan to finish.";
      return;
    }
    if (inventory !== window.__oneDriveInventoryReport) {
      status.textContent = "Inventory changed. Check disk again.";
      download.disabled = test.disabled = true;
      return;
    }
    busy(true);
    controller = new AbortController();
    try {
      let targetRoot = root;
      let selectedPlan = sample ? samplePlan(plan) : plan;
      if (recovery) {
        targetRoot = await showDirectoryPicker({
          id: "onedrive-recovery",
          mode: "readwrite",
        });
        selectedPlan = await recoveryPlan({
          plan,
          report: inventory,
          originalRoot: root,
          root: targetRoot,
          signal: controller.signal,
        });
        window.__oneDriveRecoveryPlan = selectedPlan;
      }
      const base = endpoint();
      window.__oneDriveDownloadResult = null;
      window.__oneDriveActivity?.({ stage: "Starting", reset: true });
      result = await populate({
        plan: selectedPlan,
        concurrency: Number(parallel.value),
        root: targetRoot,
        signal: controller.signal,
        activity: (entry) => window.__oneDriveActivity?.(entry),
        progress: (p) =>
          (status.textContent =
            p.downloaded +
            " files downloaded · " +
            (p.bytes / 1024 ** 2).toFixed(1) +
            " MB · " +
            (p.foldersCreated || 0) +
            " folders created · " +
            p.errors +
            " issues"),
        fetchFile: async (row, signal, setStep) => {
          const timeout = AbortSignal.any([
            signal,
            AbortSignal.timeout(5 * 60 * 1000),
          ]);
          setStep("request_metadata");
          const response = await fetch(
            base + "/items/" + encodeURIComponent(row.id),
            {
              method: "GET",
              credentials: "same-origin",
              redirect: "error",
              signal: timeout,
              headers: { Accept: "application/json" },
            },
          );
          if (!response.ok) throw fail("metadata_http_" + response.status);
          setStep("read_metadata");
          const meta = await response.json();
          if (
            meta.id !== row.id ||
            meta.size !== row.size ||
            meta.name !== row.name ||
            meta.lastModifiedDateTime !== row.modified ||
            meta.parentReference?.id !== row.parentId
          )
            throw fail("remote_changed_rescan");
          const link =
            meta["@microsoft.graph.downloadUrl"] ||
            meta["@content.downloadUrl"];
          if (typeof link !== "string") throw fail("download_url_missing");
          const url = new URL(link, location.origin);
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            !(
              url.hostname === "onedrive.live.com" ||
              url.hostname.endsWith(".files.1drv.com") ||
              url.hostname.endsWith(".sharepoint.com") ||
              url.hostname.endsWith(".storage.live.com")
            )
          )
            throw fail("unrecognized_download_host");
          setStep("request_download");
          const content = await fetch(url.href, {
            method: "GET",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: timeout,
          });
          if (!content.ok) throw fail("download_http_" + content.status);
          return content;
        },
      });
      result.scope = recovery
        ? "separate_recovery_folder"
        : sample
          ? "small_file_test"
          : "all_missing";
      window.__oneDriveDownloadResult = result;
      window.__oneDriveActivity?.({
        stage:
          result.status === "finished" ? "Finished" : "Stopped with issues",
        finished: true,
      });
      status.textContent =
        (recovery ? "Recovery folder: " + targetRoot.name + ". " : "") +
        result.status +
        ": " +
        result.downloaded +
        " files downloaded; " +
        result.issues.length +
        " issues. Browser downloads use current dates; export date repair JSON to restore source dates.";
      detail.textContent = JSON.stringify(
        {
          downloaded: result.downloaded,
          foldersCreated: result.foldersCreated,
          bytes: result.bytes,
          skipped: result.skipped,
          issues: result.issues.length,
        },
        null,
        2,
      );
      save.disabled = false;
    } catch (e) {
      status.textContent =
        e.code === "choose_separate_recovery_folder"
          ? "Choose a separate recovery folder outside the original folder tree. No copies started."
          : recovery && e.name === "AbortError"
            ? "Recovery folder selection cancelled."
            : "Download stopped: " + (e.code || e.name);
      window.__oneDriveActivity?.({
        stage: "Issue",
        code: e.code || e.name,
        finished: true,
      });
    } finally {
      busy(false);
      download.disabled = test.disabled = true;
    }
  };
  download.onclick = () => startDownload(false);
  test.onclick = () => startDownload(true);
  recover.onclick = () => startDownload(false, true);
  cancel.onclick = () => controller?.abort();
  save.onclick = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { plan, result, recoveryPlan: window.__oneDriveRecoveryPlan },
            null,
            2,
          ),
        ],
        {
          type: "application/json",
        },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "onedrive-disk-report-" + Date.now() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  console.log("Local disk controls ready. Choose a local folder in the panel.");
})();
