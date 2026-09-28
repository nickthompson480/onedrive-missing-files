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
    const listings = new Map();
    async function openDirectory(parent, name, prefix, create) {
      try {
        return await operation("open_local_folder", prefix, () =>
          parent.getDirectoryHandle(name),
        );
      } catch (e) {
        if (e.name !== "NotFoundError") throw e;
      }
      // A named lookup can disagree with the provider's directory listing.
      // Use only an exact, browser-issued handle; never guess or rename a path.
      if (typeof parent.entries === "function") {
        const parentPath = prefix.slice(0, prefix.lastIndexOf("/"));
        if (!listings.has(parentPath)) {
          const listing = new Map();
          await operation("list_local_folder", parentPath || "/", async () => {
            for await (const [entryName, entry] of parent.entries()) {
              if (listing.size >= 10000) throw fail("folder_listing_limit");
              listing.set(entryName, entry);
            }
          });
          listings.set(parentPath, listing);
        }
        const listing = listings.get(parentPath),
          entry = listing.get(name);
        if (entry) {
          if (entry.kind !== "directory")
            throw Object.assign(fail("TypeMismatchError"), {
              operation: "open_local_folder",
              localPath: prefix,
            });
          return entry;
        }
        if ([...listing.keys()].some((x) => key(x) === key(name)))
          throw Object.assign(fail("local_name_mismatch"), {
            operation: "open_local_folder",
            localPath: prefix,
          });
      }
      if (!create) return null;
      const handle = await operation("create_local_folder", prefix, () =>
        parent.getDirectoryHandle(name, { create: true }),
      );
      listings.delete(prefix.slice(0, prefix.lastIndexOf("/")));
      return handle;
    }
    async function directory(segments, create = false, fresh = false) {
      let handle = root,
        prefix = "";
      for (const name of segments) {
        prefix += "/" + name;
        if (!fresh && cache.has(prefix) && (cache.get(prefix) || !create))
          handle = cache.get(prefix);
        else if (handle) {
          handle = await openDirectory(handle, name, prefix, create);
          cache.set(prefix, handle);
        }
        if (!handle) return null;
      }
      return handle;
    }
    async function inspect(segments, type, fresh = false) {
      if (type === "folder") {
        return {
          status: (await directory(segments, false, fresh))
            ? "present"
            : "missing",
        };
      }
      const parent = await directory(segments.slice(0, -1), false, fresh);
      if (!parent) return { status: "missing" };
      const path = "/" + segments.join("/");
      let handle;
      try {
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
  function applyNativeAudit({ audit, report, plan }) {
    validateInventory(report);
    if (plan?.status !== "checked" || plan.inventoryStarted !== report.started)
      throw fail("check_disk_first");
    const files = report.items.filter((x) => x.type === "file");
    if (
      audit?.kind !== "onedrive_native_disk_check" ||
      audit.version !== 1 ||
      audit.status !== "finished" ||
      audit.folder !== plan.folder ||
      typeof audit.checked !== "string" ||
      !Number.isFinite(Date.parse(audit.checked)) ||
      !Array.isArray(audit.items) ||
      audit.items.length !== files.length
    )
      throw fail("native_check_does_not_match");
    const current = new Map(files.map((x) => [x.id, x]));
    const checked = new Map();
    for (const row of audit.items) {
      const source = current.get(row.id);
      if (
        !source ||
        checked.has(row.id) ||
        ["path", "type", "size", "name", "parentId"].some(
          (k) => row[k] !== source[k],
        ) ||
        !Number.isFinite(Date.parse(row.modified)) ||
        Date.parse(row.modified) !== Date.parse(source.modified) ||
        !["present", "missing", "existing_size_mismatch", "conflict"].includes(
          row.status,
        )
      )
        throw fail("native_check_does_not_match");
      if (
        ["present", "existing_size_mismatch"].includes(row.status) &&
        (!Number.isSafeInteger(row.localSize) ||
          row.localSize < 0 ||
          (row.localSize === source.size) !== (row.status === "present"))
      )
        throw fail("invalid_native_size");
      checked.set(row.id, row);
    }
    const items = plan.items.map((old) => {
      const row = checked.get(old.id);
      if (!row) return old;
      // Native metadata cannot resolve source name collisions or unsafe paths.
      if (
        old.status === "conflict" &&
        old.reason !== "browser_restricted_file_type"
      )
        return old;
      if (
        old.reason === "browser_restricted_file_type" &&
        row.status === "missing"
      )
        return old;
      const { reason, localSize, operation, localPath, ...base } = old;
      const result = { ...base, status: row.status };
      if (["present", "existing_size_mismatch"].includes(row.status))
        result.localSize = row.localSize;
      if (row.status === "existing_size_mismatch" && row.localSize === 0)
        result.reason = "empty_local_file";
      if (row.status === "conflict") result.reason = "native_access_error";
      return result;
    });
    const counts = {};
    for (const row of items) counts[row.status] = (counts[row.status] || 0) + 1;
    return {
      ...plan,
      items,
      counts,
      scope: "native_disk_check",
      nativeChecked: audit.checked,
      missingBytes: items
        .filter((x) => x.type === "file" && x.status === "missing")
        .reduce((n, x) => n + x.size, 0),
    };
  }
  async function recoveryPlan({
    plan,
    report,
    originalRoot,
    root,
    signal,
    status = "existing_size_mismatch",
  }) {
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
        .filter((x) => x.status === status && x.type === "file")
        .map((x) => x.id),
    );
    if (!["missing", "existing_size_mismatch"].includes(status))
      throw fail("invalid_recovery_scope");
    if (!selected.size) throw fail("no_recovery_files");
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
      blockedFiles: 0,
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
    const failedFolders = new Map();
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
        const failedParent = [...failedFolders].find(([path]) =>
          path === "/" ? true : row.path.startsWith(path + "/"),
        );
        if (failedParent) {
          result.skipped++;
          if (row.type === "file") {
            result.blockedFiles++;
            failedParent[1].blockedFiles++;
          }
          update("Skipped", true, "parent_folder_unavailable");
          return;
        }
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
        // Resolve/create parents before requesting content, avoiding doomed transfers.
        await fs.directory(segments.slice(0, -1), true, true);
        checkStop();
        update("Requesting file");
        step = "request_file";
        response = await fetchFile(row, runSignal, (value) => {
          step = value;
          if (value === "retry_wait") update("Waiting to retry");
          if (value === "single_stream_fallback")
            update("Restarting with one stream");
        });
        if (!response?.body && !response?.transferTo)
          throw fail("missing_download_stream");
        // Recheck after the network request; never intentionally replace an existing file.
        if ((await fs.inspect(segments, "file", true)).status !== "missing") {
          await cancelDownload(response);
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
          await cancelDownload(response);
          result.skipped++;
          update("Skipped", true, "existing_file_preserved");
          return;
        }
        checkStop();
        step = "open_write_stream";
        writable = await operation(step, row.path, () =>
          handle.createWritable({ keepExistingData: false, mode: "exclusive" }),
        );
        let bytes = 0;
        if (response.transferTo) {
          step = "read_download_stream";
          bytes = await response.transferTo(writable, (count, stage) => {
            checkStop();
            if (count > row.size || result.bytes + count > maxBytes)
              throw fail("download_size_mismatch");
            fileBytes = count;
            update(stage, false);
          });
        } else {
          const reader = response.body.getReader();
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
          } finally {
            runSignal.removeEventListener("abort", abortRead);
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
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
        const folderFailure =
          [
            "open_local_folder",
            "create_local_folder",
            "list_local_folder",
          ].includes(step) && e.localPath;
        const prior = folderFailure && failedFolders.get(e.localPath);
        const issue = prior || {
          path: row.path,
          code,
          operation: step,
          localPath: e.localPath,
          size: row.size,
          bytes: fileBytes,
        };
        if (!prior) result.issues.push(issue);
        if (folderFailure) {
          issue.blockedFiles =
            (issue.blockedFiles || 0) + (row.type === "file" ? 1 : 0);
          if (row.type === "file") result.blockedFiles++;
          failedFolders.set(e.localPath, issue);
        }
        if (prior) result.skipped++;
        update(
          prior ? "Skipped" : "Issue",
          true,
          prior ? "parent_folder_unavailable" : code,
        );
        // Preserve any empty placeholder; report it on the next disk check.
      } finally {
        await cancelDownload(response);
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
  async function fetchDownloadAttempt({
    row,
    base,
    origin,
    signal,
    setStep = () => {},
    request = fetch,
    idleMs = 5 * 60 * 1000,
    offset = 0,
    rangeEnd = null,
    version = null,
    verifyOnly = false,
  }) {
    if (!Number.isSafeInteger(idleMs) || idleMs < 1)
      throw fail("invalid_budget");
    const sourceMetadata =
      typeof module !== "undefined" && module.exports
        ? require("./inventory.js").sourceMetadata
        : window.__oneDriveInventoryLibrary.sourceMetadata;
    const idle = new AbortController();
    const timeout = AbortSignal.any([signal, idle.signal].filter(Boolean));
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          idle.abort(new DOMException("No download progress", "TimeoutError")),
        idleMs,
      );
    };
    const httpError = (prefix, response) => {
      const error = fail(prefix + response.status);
      const retry = response.headers?.get("Retry-After");
      if (retry !== null && retry !== undefined) {
        const delay = /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now();
        if (Number.isFinite(delay)) error.retryAfterMs = Math.max(0, delay);
      }
      response.body?.cancel().catch(() => {});
      return error;
    };
    arm();
    try {
      setStep("request_metadata");
      const response = await request(
        base + "/items/" + encodeURIComponent(row.id),
        {
          method: "GET",
          credentials: "same-origin",
          redirect: "error",
          signal: timeout,
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) throw httpError("metadata_http_", response);
      setStep("read_metadata");
      const meta = await response.json();
      arm();
      if (
        meta.id !== row.id ||
        meta.size !== row.size ||
        meta.name !== row.name ||
        meta.lastModifiedDateTime !== row.modified ||
        meta.parentReference?.id !== row.parentId
      )
        throw fail("remote_changed_rescan");
      const currentVersion =
        typeof meta.cTag === "string" && meta.cTag
          ? "cTag:" + meta.cTag
          : typeof meta.eTag === "string" && meta.eTag
            ? "eTag:" + meta.eTag
            : null;
      if (version && currentVersion !== version)
        throw fail("remote_changed_rescan");
      if ((offset || rangeEnd !== null) && !(version || currentVersion))
        throw fail("resume_version_unavailable");
      if (verifyOnly) {
        clearTimeout(timer);
        return { metadata: sourceMetadata(meta), version: currentVersion };
      }
      const link =
        meta["@microsoft.graph.downloadUrl"] || meta["@content.downloadUrl"];
      if (typeof link !== "string") throw fail("download_url_missing");
      const url = new URL(link, origin);
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
      const content = await request(url.href, {
        method: "GET",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        ...(offset || rangeEnd !== null
          ? { headers: { Range: "bytes=" + offset + "-" + (rangeEnd ?? "") } }
          : {}),
        signal: timeout,
      });
      if (!content.ok) throw httpError("download_http_", content);
      if (offset || rangeEnd !== null) {
        const range = content.headers?.get("Content-Range");
        if (
          content.status !== 206 ||
          range !== `bytes ${offset}-${rangeEnd ?? row.size - 1}/${row.size}`
        ) {
          await content.body?.cancel().catch(() => {});
          throw fail("resume_range_unverified");
        }
      } else if (content.status === 206) {
        await content.body?.cancel().catch(() => {});
        throw fail("unexpected_partial_download");
      }
      const metadata = sourceMetadata(meta);
      if (!content.body) throw fail("download_body_missing");
      const reader = content.body.getReader();
      let onAbort,
        settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        timeout.removeEventListener("abort", onAbort);
      };
      const body = new ReadableStream({
        start(controller) {
          onAbort = () => {
            cleanup();
            reader.cancel(timeout.reason).catch(() => {});
            controller.error(timeout.reason);
          };
          timeout.addEventListener("abort", onAbort, { once: true });
          if (timeout.aborted) onAbort();
        },
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (settled) return;
            if (chunk.done) {
              cleanup();
              controller.close();
            } else {
              arm();
              controller.enqueue(chunk.value);
            }
          } catch (error) {
            if (!settled) {
              cleanup();
              controller.error(error);
            }
          }
        },
        cancel(reason) {
          cleanup();
          return reader.cancel(reason);
        },
      });
      return { body, metadata, version: currentVersion };
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }
  // Keep one writable stream open across bounded network retries. Nothing is
  // committed until populate has received and verified the complete stream.
  async function fetchDownload(options) {
    const {
      maxRetries = 4,
      retryBaseMs = 2000,
      retryMaxMs = 5 * 60 * 1000,
    } = options;
    if (
      !Number.isInteger(maxRetries) ||
      maxRetries < 0 ||
      maxRetries > 10 ||
      !Number.isSafeInteger(retryBaseMs) ||
      retryBaseMs < 0 ||
      !Number.isSafeInteger(retryMaxMs) ||
      retryMaxMs < 0
    )
      throw fail("invalid_retry_budget");
    const cancelled = new AbortController();
    const signal = AbortSignal.any(
      [options.signal, cancelled.signal].filter(Boolean),
    );
    const startOffset = options.rangeStart ?? 0;
    const endOffset =
      options.rangeEnd === undefined ? options.row.size : options.rangeEnd + 1;
    if (
      !Number.isSafeInteger(startOffset) ||
      !Number.isSafeInteger(endOffset) ||
      startOffset < 0 ||
      endOffset > options.row.size ||
      startOffset > endOffset
    )
      throw fail("invalid_download_range");
    let retries = 0,
      offset = startOffset,
      version = options.version || null,
      reader,
      initial;
    const check = () => {
      if (signal.aborted) throw signal.reason;
    };
    const wait = (ms) =>
      new Promise((resolve, reject) => {
        check();
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, ms);
        signal.addEventListener("abort", abort, { once: true });
      });
    const retry = async (error) => {
      check();
      if (options.failOnThrottle && /_http_(429|503)$/.test(error.code || ""))
        throw error;
      const transient =
        ["TypeError", "TimeoutError"].includes(error.name) ||
        /^(metadata|download)_http_(408|429|500|502|503|504)$/.test(
          error.code || "",
        ) ||
        error.code === "download_http_403" ||
        error.code === "download_truncated";
      if (
        !transient ||
        retries >= maxRetries ||
        (offset > startOffset && offset >= endOffset)
      )
        throw error;
      if (offset > startOffset && !version)
        throw fail("resume_version_unavailable");
      const delay = Math.max(
        retryBaseMs * 2 ** retries,
        error.retryAfterMs || 0,
      );
      if (delay > retryMaxMs) throw fail("retry_wait_exceeds_budget");
      retries++;
      options.setStep?.("retry_wait");
      await wait(delay);
    };
    const open = async () => {
      while (true) {
        check();
        try {
          const response = await fetchDownloadAttempt({
            ...options,
            signal,
            offset,
            version,
          });
          if (!initial) {
            initial = response;
            version = response.version;
          }
          reader = response.body.getReader();
          return;
        } catch (error) {
          await retry(error);
        }
      }
    };
    const release = async () => {
      const activeReader = reader;
      reader = null;
      if (activeReader) {
        await activeReader.cancel().catch(() => {});
        activeReader.releaseLock();
      }
    };
    await open();
    let settled = false;
    const body = new ReadableStream({
      async pull(controller) {
        while (!settled) {
          try {
            check();
            if (!reader) await open();
            const { done, value } = await reader.read();
            check();
            if (done) {
              if (offset !== endOffset) throw fail("download_truncated");
              if ((retries || options.rangeEnd !== undefined) && version)
                await fetchDownloadAttempt({
                  ...options,
                  signal,
                  version,
                  verifyOnly: true,
                });
              settled = true;
              await release();
              controller.close();
              return;
            }
            if (offset + value.byteLength > endOffset)
              throw fail("download_size_mismatch");
            offset += value.byteLength;
            controller.enqueue(value);
            return;
          } catch (error) {
            await release();
            if (settled) return;
            try {
              await retry(error);
            } catch (finalError) {
              settled = true;
              cancelled.abort(finalError);
              controller.error(finalError);
              return;
            }
          }
        }
      },
      async cancel(reason) {
        settled = true;
        cancelled.abort(reason);
        await release();
      },
    });
    return { body, metadata: initial.metadata, version };
  }
  async function cancelDownload(response) {
    if (response?.cancel) await response.cancel();
    else if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => {});
  }
  async function fetchFileDownload(options) {
    const { streams = 1, largeFileBytes = 256 * 1024 ** 2 } = options;
    if (
      ![1, 2, 3].includes(streams) ||
      !Number.isSafeInteger(largeFileBytes) ||
      largeFileBytes < 1
    )
      throw fail("invalid_stream_count");
    if (streams === 1 || options.row.size < Math.max(streams, largeFileBytes))
      return fetchDownload(options);
    const group = new AbortController();
    const signal = AbortSignal.any(
      [options.signal, group.signal].filter(Boolean),
    );
    const width = Math.ceil(options.row.size / streams);
    const ranges = Array.from({ length: streams }, (_, n) => ({
      rangeStart: n * width,
      rangeEnd: Math.min((n + 1) * width, options.row.size) - 1,
    })).filter((r) => r.rangeStart <= r.rangeEnd);
    const canFallback = (error) =>
      ["resume_range_unverified", "resume_version_unavailable"].includes(
        error.code,
      ) || /_http_(429|503)$/.test(error.code || "");
    const pause = async (error) => {
      if (!/_http_(429|503)$/.test(error.code || "")) return;
      const delay = Math.max(
        options.retryBaseMs ?? 2000,
        error.retryAfterMs || 0,
      );
      if (delay > (options.retryMaxMs ?? 300000))
        throw fail("retry_wait_exceeds_budget");
      options.setStep?.("retry_wait");
      await new Promise((resolve, reject) => {
        if (options.signal?.aborted) return reject(options.signal.reason);
        const abort = () => {
          clearTimeout(timer);
          reject(options.signal.reason);
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", abort);
          resolve();
        }, delay);
        options.signal?.addEventListener("abort", abort, { once: true });
      });
    };
    let first;
    try {
      first = await fetchDownload({
        ...options,
        ...ranges[0],
        signal,
        failOnThrottle: true,
      });
    } catch (error) {
      if (options.signal?.aborted || !canFallback(error)) throw error;
      await pause(error);
      options.setStep?.("single_stream_fallback");
      return fetchDownload(options);
    }
    let used = false;
    return {
      metadata: first.metadata,
      cancel: async () => {
        group.abort();
        await cancelDownload(first);
      },
      async transferTo(writable, onProgress) {
        if (used) throw fail("transfer_already_used");
        used = true;
        let total = 0,
          failure,
          writes = Promise.resolve();
        const copy = async (response, position, partSignal, stage) => {
          const reader = response.body.getReader();
          try {
            while (true) {
              if (partSignal?.aborted) throw partSignal.reason;
              const { done, value } = await reader.read();
              if (partSignal?.aborted) throw partSignal.reason;
              if (done) return;
              const at = position;
              const write = writes.then(async () => {
                if (partSignal?.aborted) throw partSignal.reason;
                try {
                  await writable.write({
                    type: "write",
                    position: at,
                    data: value,
                  });
                } catch (error) {
                  error.operation = "write_local_file";
                  throw error;
                }
                total += value.byteLength;
                onProgress(total, stage);
              });
              writes = write.catch(() => {});
              await write;
              position += value.byteLength;
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        };
        const workers = ranges.map(async (range, n) => {
          try {
            const response =
              n === 0
                ? first
                : await fetchDownload({
                    ...options,
                    ...range,
                    version: first.version,
                    signal,
                    failOnThrottle: true,
                  });
            await copy(
              response,
              range.rangeStart,
              signal,
              `Downloading (${ranges.length} streams)`,
            );
          } catch (error) {
            if (!failure) {
              failure = error;
              group.abort(error);
            }
          }
        });
        await Promise.all(workers);
        if (!failure) return total;
        if (
          options.signal?.aborted ||
          failure.operation === "write_local_file" ||
          !canFallback(failure)
        )
          throw failure;
        // Restart only this run's uncommitted scratch write; no existing file is replaced.
        await pause(failure);
        options.setStep?.("single_stream_fallback");
        try {
          await writable.truncate(0);
        } catch (error) {
          error.operation = "write_local_file";
          throw error;
        }
        total = 0;
        onProgress(0, "Restarting with one stream");
        const response = await fetchDownload({
          ...options,
          version: first.version,
        });
        await copy(response, 0, options.signal, "Downloading (1 stream)");
        return total;
      },
    };
  }
  const api = {
    parts,
    checkDisk,
    populate,
    validateInventory,
    samplePlan,
    recoveryPlan,
    applyNativeAudit,
    fetchDownload,
    fetchFileDownload,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  window.__oneDriveDiskLibrary = api;
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
    recover = el("button", "Copy size mismatches elsewhere"),
    importNative = el("button", "Import native disk check"),
    recoverMissing = el("button", "Copy missing elsewhere"),
    testRecovery = el("button", "Test 3 recovery files");
  const nativeFile = document.createElement("input");
  nativeFile.type = "file";
  nativeFile.accept = ".json,application/json";
  nativeFile.hidden = true;
  block.append(nativeFile);
  el(
    "p",
    "For empty or differing local files, copy the OneDrive versions to a separate folder for review. Originals stay unchanged.",
  );
  el(
    "p",
    "If Explorer sees folders that the browser cannot open, save the disk report and run check-disk.ps1. Import its result here, then copy missing files or size mismatches to a separate ordinary folder. Native checks compare sizes only; linked folders are not independent backup copies.",
  );
  check.disabled =
    download.disabled =
    test.disabled =
    cancel.disabled =
    save.disabled =
    recover.disabled =
    importNative.disabled =
    recoverMissing.disabled =
    testRecovery.disabled =
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
  parallel.value = "1";
  concurrencyLabel.append(parallel);
  const streamLabel = el("label", " Large-file streams (256 MiB+) ");
  const streams = document.createElement("select");
  streams.setAttribute("aria-label", "Large-file streams");
  for (const n of [1, 2, 3]) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = String(n);
    streams.append(option);
  }
  streams.value = "1";
  streamLabel.append(streams);
  streams.onchange = () => {
    if (Number(streams.value) > 1) parallel.value = "1";
  };
  el(
    "p",
    "Two or three streams split each large file into ranges. This mode processes one file at a time; small files use one stream. Unsupported ranges or throttling fall back to one stream.",
  );
  const runLabel = el("label", " Run budget ");
  const runBudget = document.createElement("select");
  runBudget.setAttribute("aria-label", "Run budget");
  for (const [value, label] of [
    ["standard", "Standard: 5 GiB / 1 hour"],
    ["large", "Large recovery: 100 GiB / 12 hours"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    runBudget.append(option);
  }
  runLabel.append(runBudget);
  const detail = el("pre", "");
  let root, plan, result, controller, inventory;
  const scanButton = [...section.querySelectorAll("button")].find(
    (x) => x.textContent === "Scan OneDrive",
  );
  const closeButton = [...section.querySelectorAll("button")].find(
    (x) => x.textContent === "Close",
  );
  const controls = [
    choose,
    check,
    download,
    test,
    parallel,
    streams,
    runBudget,
    recover,
    importNative,
    recoverMissing,
    testRecovery,
  ];
  const busy = (value) => {
    window.__oneDriveDiskBusy = value;
    controls.forEach((x) => (x.disabled = value));
    scanButton.disabled = value;
    closeButton.disabled = value;
    cancel.disabled = !value;
    if (!value) {
      importNative.disabled = !plan;
      recoverMissing.disabled = testRecovery.disabled = !plan?.items.some(
        (x) => x.type === "file" && x.status === "missing",
      );
      recover.disabled = !plan?.items.some(
        (x) => x.status === "existing_size_mismatch",
      );
    }
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
      download.disabled =
        test.disabled =
        recover.disabled =
        importNative.disabled =
        recoverMissing.disabled =
        testRecovery.disabled =
          true;
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
    if (
      window.__oneDriveInventoryScanning ||
      window.__oneDriveMetadataBusy ||
      window.__oneDriveArchiveBusy
    ) {
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
  importNative.onclick = () => {
    nativeFile.value = "";
    nativeFile.click();
  };
  nativeFile.onchange = async () => {
    const file = nativeFile.files?.[0];
    if (!file) return;
    if (
      window.__oneDriveDiskBusy ||
      window.__oneDriveInventoryScanning ||
      window.__oneDriveMetadataBusy ||
      window.__oneDriveArchiveBusy
    )
      return;
    busy(true);
    try {
      if (file.size > 64 * 1024 ** 2) throw fail("native_report_too_large");
      plan = applyNativeAudit({
        audit: JSON.parse((await file.text()).replace(/^\uFEFF/, "")),
        report: window.__oneDriveInventoryReport,
        plan,
      });
      inventory = window.__oneDriveInventoryReport;
      window.__oneDriveDiskPlan = plan;
      result = null;
      window.__oneDriveDownloadResult = null;
      window.__oneDriveRecoveryPlan = null;
      window.__oneDriveActivity?.({ clearIssues: true });
      const count = (kind) =>
        plan.items.filter((x) => x.type === "file" && x.status === kind).length;
      status.textContent =
        "Native check: " +
        count("missing") +
        " missing files; " +
        count("existing_size_mismatch") +
        " size mismatches; " +
        count("conflict") +
        " unresolved. Use separate-folder recovery. Equal size does not verify contents.";
      detail.textContent = JSON.stringify(plan.counts, null, 2);
      save.disabled = false;
    } catch (e) {
      status.textContent = "Native check import stopped: " + (e.code || e.name);
    } finally {
      busy(false);
      download.disabled = test.disabled = true;
    }
  };
  const startDownload = async (sample = false, recovery = false) => {
    if (
      window.__oneDriveInventoryScanning ||
      window.__oneDriveMetadataBusy ||
      window.__oneDriveArchiveBusy
    ) {
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
          status: recovery === "missing" ? "missing" : "existing_size_mismatch",
        });
        window.__oneDriveRecoveryPlan = selectedPlan;
        if (sample) selectedPlan = samplePlan(selectedPlan);
      }
      const base = endpoint();
      window.__oneDriveDownloadResult = null;
      window.__oneDriveActivity?.({ stage: "Starting", reset: true });
      result = await populate({
        plan: selectedPlan,
        concurrency: Number(streams.value) > 1 ? 1 : Number(parallel.value),
        maxBytes: (runBudget.value === "large" ? 100 : 5) * 1024 ** 3,
        maxMs: (runBudget.value === "large" ? 12 : 1) * 60 * 60 * 1000,
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
        fetchFile: (row, signal, setStep) =>
          fetchFileDownload({
            streams: Number(streams.value),
            row,
            base,
            origin: location.origin,
            signal,
            setStep,
          }),
      });
      result.scope = recovery
        ? sample
          ? "recovery_small_file_test"
          : recovery === "missing"
            ? "missing_recovery_folder"
            : "separate_recovery_folder"
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
          blockedFiles: result.blockedFiles,
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
  recoverMissing.onclick = () => startDownload(false, "missing");
  testRecovery.onclick = () => startDownload(true, "missing");
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
