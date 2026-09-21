/* One restricted original file per ZIP, extracted only by the offline helper. */
(function () {
  "use strict";
  const disk =
    typeof module !== "undefined" && module.exports
      ? require("./disk-tools.js")
      : window.__oneDriveDiskLibrary;
  const fail = (code) => Object.assign(new Error(code), { code });
  const encoder = new TextEncoder();
  function candidates(report, plan) {
    disk.validateInventory(report);
    if (plan?.status !== "checked" || plan.inventoryStarted !== report.started)
      throw fail("check_disk_first");
    const selected = new Map(
      plan.items
        .filter(
          (x) =>
            x.type === "file" && x.reason === "browser_restricted_file_type",
        )
        .map((x) => [x.id, x]),
    );
    const rows = report.items.filter((x) => selected.has(x.id));
    let bytes = 0;
    const paths = new Set();
    for (const row of rows) {
      disk.parts(row.path);
      if (
        !/\.(lnk|ini|url|scf)$/i.test(row.path) ||
        row.type !== "file" ||
        row.path !== selected.get(row.id).path ||
        row.size !== selected.get(row.id).size
      )
        throw fail("check_disk_again");
      if (
        !Number.isSafeInteger(row.size) ||
        row.size < 0 ||
        row.size > 16 * 1024 ** 2
      )
        throw fail("archive_file_limit");
      bytes += row.size;
      const key = row.path.normalize("NFC").toLowerCase();
      if (paths.has(key)) throw fail("archive_path_collision");
      paths.add(key);
    }
    if (!rows.length) throw fail("no_restricted_files");
    if (rows.length > 1000 || bytes > 64 * 1024 ** 2)
      throw fail("archive_batch_limit");
    return rows;
  }
  function crc32(data) {
    let crc = -1;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }
  function zipOne(path, data, metadata) {
    disk.parts(path);
    const name = encoder.encode(path.slice(1));
    const comment = encoder.encode(JSON.stringify(metadata));
    if (
      name.length > 8192 ||
      comment.length > 16384 ||
      data.length > 16 * 1024 ** 2
    )
      throw fail("archive_file_limit");
    const local = new Uint8Array(30 + name.length),
      central = new Uint8Array(46 + name.length),
      end = new Uint8Array(22 + comment.length);
    const a = new DataView(local.buffer),
      b = new DataView(central.buffer),
      c = new DataView(end.buffer);
    const crc = crc32(data);
    a.setUint32(0, 0x04034b50, true);
    a.setUint16(4, 20, true);
    a.setUint16(6, 0x800, true);
    a.setUint16(12, 33, true);
    a.setUint32(14, crc, true);
    a.setUint32(18, data.length, true);
    a.setUint32(22, data.length, true);
    a.setUint16(26, name.length, true);
    local.set(name, 30);
    b.setUint32(0, 0x02014b50, true);
    b.setUint16(4, 20, true);
    b.setUint16(6, 20, true);
    b.setUint16(8, 0x800, true);
    b.setUint16(14, 33, true);
    b.setUint32(16, crc, true);
    b.setUint32(20, data.length, true);
    b.setUint32(24, data.length, true);
    b.setUint16(28, name.length, true);
    central.set(name, 46);
    c.setUint32(0, 0x06054b50, true);
    c.setUint16(8, 1, true);
    c.setUint16(10, 1, true);
    c.setUint32(12, central.length, true);
    c.setUint32(16, local.length + data.length, true);
    c.setUint16(20, comment.length, true);
    end.set(comment, 22);
    return new Blob([local, data, central, end], { type: "application/zip" });
  }
  const hex = (buffer) =>
    [...new Uint8Array(buffer)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  async function makeArchive(row, response, signal) {
    if (
      !Number.isSafeInteger(row.size) ||
      row.size < 0 ||
      row.size > 16 * 1024 ** 2
    )
      throw fail("archive_file_limit");
    const meta = response.metadata || {};
    const algorithm = meta.sha256 ? "SHA-256" : meta.sha1 ? "SHA-1" : null;
    if (!algorithm) throw fail("source_hash_missing");
    if (!response.body) throw fail("missing_download_stream");
    const data = new Uint8Array(row.size),
      reader = response.body.getReader();
    let length = 0;
    const stop = () => reader.cancel().catch(() => {});
    signal?.addEventListener("abort", stop, { once: true });
    try {
      while (true) {
        if (signal?.aborted) throw fail("cancelled");
        const { value, done } = await reader.read();
        if (signal?.aborted) throw fail("cancelled");
        if (done) break;
        if (length + value.length > row.size)
          throw fail("download_size_mismatch");
        data.set(value, length);
        length += value.length;
      }
    } finally {
      signal?.removeEventListener("abort", stop);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (length !== row.size) throw fail("download_size_mismatch");
    const sourceHash = hex(await crypto.subtle.digest(algorithm, data));
    if (sourceHash !== (meta.sha256 || meta.sha1).toLowerCase())
      throw fail("source_hash_mismatch");
    const sha256 =
      algorithm === "SHA-256"
        ? sourceHash
        : hex(await crypto.subtle.digest("SHA-256", data));
    if (signal?.aborted) throw fail("cancelled");
    return zipOne(row.path, data, {
      kind: "onedrive-single-file",
      version: 1,
      path: row.path,
      size: row.size,
      sha256,
      fileCreated: meta.fileCreated || null,
      fileModified: meta.fileModified || null,
    });
  }
  async function saveArchive(root, name, blob, signal) {
    let handle, writable;
    try {
      try {
        await root.getFileHandle(name);
        throw fail("existing_zip_preserved");
      } catch (e) {
        if (e.name !== "NotFoundError") throw e;
      }
      if (signal?.aborted) throw fail("cancelled");
      handle = await root.getFileHandle(name, { create: true });
      if ((await handle.getFile()).size !== 0)
        throw fail("existing_zip_preserved");
      writable = await handle.createWritable({ mode: "exclusive" });
      await writable.write(blob);
      if (signal?.aborted) throw fail("cancelled");
      await writable.close();
      writable = null;
      const saved = await handle.getFile();
      if (
        saved.size !== blob.size ||
        hex(
          await crypto.subtle.digest("SHA-256", await saved.arrayBuffer()),
        ) !==
          hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))
      )
        throw fail("zip_readback_failed");
    } finally {
      if (writable) await writable.abort().catch(() => {});
    }
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { candidates, crc32, zipOne, makeArchive, saveArchive };
    return;
  }
  const host = document.getElementById("od-inventory-tool"),
    section = host?.shadowRoot?.querySelector("section");
  if (!section) return;
  const block = document.createElement("div");
  section.append(block);
  const add = (tag, text) => {
    const e = document.createElement(tag);
    e.textContent = text;
    block.append(e);
    return e;
  };
  add("h2", "Restricted-file ZIP recovery");
  add(
    "p",
    "After Check disk, save one ZIP per browser-restricted file into a separate local folder. Each ZIP contains one original file with its folder path. Run restore-zip.py outside the browser to extract, verify and optionally delete successful ZIPs. Existing files stay unchanged.",
  );
  const run = add("button", "Download restricted ZIPs"),
    stopButton = add("button", "Stop ZIP export"),
    status = add("p", "No ZIP export running.");
  status.setAttribute("role", "status");
  stopButton.disabled = true;
  let controller;
  stopButton.onclick = () => controller?.abort();
  run.onclick = async () => {
    if (
      window.__oneDriveDiskBusy ||
      window.__oneDriveMetadataBusy ||
      window.__oneDriveInventoryScanning ||
      window.__oneDriveArchiveBusy
    ) {
      status.textContent = "Wait for the current operation to finish.";
      return;
    }
    let controls = [],
      result;
    try {
      const report = window.__oneDriveInventoryReport,
        rows = candidates(report, window.__oneDriveDiskPlan);
      controls = [...section.querySelectorAll("button,select")]
        .filter((x) => !x.dataset.navigation)
        .map((x) => [x, x.disabled]);
      controls.forEach(([x]) => (x.disabled = true));
      window.__oneDriveArchiveBusy = true;
      stopButton.disabled = false;
      controller = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15 * 60 * 1000),
      ]);
      const root = await showDirectoryPicker({
        id: "onedrive-zip-recovery",
        mode: "readwrite",
      });
      const found = performance
        .getEntriesByType("resource")
        .map((x) => new URL(x.name))
        .find(
          (u) =>
            u.origin === location.origin &&
            /^\/personal\/[a-f\d]+\/_api\//i.test(u.pathname),
        );
      if (!found) throw fail("missing_api_base");
      const base = found.pathname.split("/_api/")[0] + "/_api/v2.0/drive";
      result = {
        saved: 0,
        total: rows.length,
        folder: root.name,
        files: [],
        issues: [],
      };
      const batch = crypto.randomUUID();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let response;
        try {
          if (signal.aborted) throw fail("cancelled");
          status.textContent = `${i + 1} / ${rows.length}: ${row.path}`;
          response = await disk.fetchDownload({
            row,
            base,
            origin: location.origin,
            signal,
          });
          const blob = await makeArchive(row, response, signal);
          const name = `onedrive-file-${batch}-${String(i + 1).padStart(4, "0")}.zip`;
          await saveArchive(root, name, blob, signal);
          result.saved++;
          result.files.push({ path: row.path, zip: name });
        } catch (e) {
          result.issues.push({
            path: row.path,
            code: typeof e.code === "string" ? e.code : e.name,
          });
          if (signal.aborted || /NotAllowed|Quota/.test(e.name)) break;
        } finally {
          if (response?.body && !response.body.locked)
            await response.body.cancel().catch(() => {});
        }
      }
      window.__oneDriveArchiveResult = result;
      status.textContent = `${result.saved} / ${result.total} ZIPs saved and verified in ${root.name}; ${result.issues.length} issues. Run restore-zip.py to extract them. Original files have not been written by the browser.`;
    } catch (e) {
      status.textContent = "ZIP export stopped: " + (e.code || e.name);
    } finally {
      controls.forEach(([x, disabled]) => (x.disabled = disabled));
      stopButton.disabled = true;
      window.__oneDriveArchiveBusy = false;
    }
  };
})();
