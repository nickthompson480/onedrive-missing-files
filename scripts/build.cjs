// Build a portable offline launcher. No account data is embedded.
const fs = require("node:fs");
const path = require("node:path");
const output = path.resolve(__dirname, "../dist/onedrive-missing-files");
fs.mkdirSync(output, { recursive: true });
const code = ["inventory.js", "disk-tools.js"]
  .map((x) => fs.readFileSync(path.join(__dirname, "../src", x), "utf8"))
  .join("\n");
fs.writeFileSync(path.join(output, "onedrive-tool.js"), code);
const escaped = code
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OneDrive inventory and missing files</title><style>body{font:17px/1.6 system-ui;color:#182435;background:#f4f6f9;max-width:840px;margin:50px auto;padding:0 24px}main{background:white;padding:32px;border-radius:14px;border:1px solid #d3dce6}h1{font-size:30px;line-height:1.2}button{font:inherit;background:#165baa;color:white;border:0;border-radius:6px;padding:12px 22px;cursor:pointer}textarea{width:100%;height:170px;box-sizing:border-box;font:12px monospace}small{color:#526071}</style><main><h1>OneDrive inventory &amp; missing files</h1><p>Runs inside your signed-in OneDrive tab in desktop Chrome or Edge. Use the same files on Windows or Mac.</p><ol><li>Open <a href="https://onedrive.live.com/my" target="_blank" rel="noreferrer">OneDrive → My files</a> and sign in.</li><li>Copy the tool with the button below.</li><li>Open that tab’s developer Console: <strong>Ctrl+Shift+J</strong> on Windows, or <strong>Command+Option+J</strong> on Mac.</li><li>Paste the tool and press <strong>Ctrl+Enter</strong>. If Chrome blocks pasting, review the source below and follow its manual instructions.</li><li>Close developer tools. Click <strong>Scan OneDrive</strong>, then <strong>Choose local folder</strong>, <strong>Check disk</strong>, then <strong>Test 3 small files</strong> or <strong>Download missing</strong>.</li></ol><button id="copy">Copy tool</button><p id="status" role="status"></p><p>Choose the local folder that matches the top of My files. For example, a OneDrive item <code>/Documents/Report.pdf</code> maps to <code>your-folder/Documents/Report.pdf</code>.</p><p>Existing files are preserved. Size differences, unsupported Windows names, and access errors are reported. Keep the target folder idle while downloading. Refreshing OneDrive removes the tool; paste it again when needed.</p><p><strong>Coverage:</strong> Personal Vault, shared-with-me content outside My files, shortcut targets, recycle bin, versions and OneNote package internals are not covered. This is a missing-file copier, not a verified backup or a two-way sync.</p><details><summary>Review or manually copy the script</summary><textarea id="source" readonly spellcheck="false">${escaped}</textarea></details><small>This launcher runs locally and loads no external resources. The script only contacts Microsoft from your OneDrive tab. Browser credentials and download links are not exported.</small></main><script>document.getElementById('copy').onclick=async()=>{const text=document.getElementById('source').value;try{await navigator.clipboard.writeText(text);document.getElementById('status').textContent='Copied. Paste in the OneDrive developer Console and press Ctrl+Enter.'}catch(e){document.querySelector('details').open=true;document.getElementById('source').select();document.getElementById('status').textContent='Press Ctrl+C (Command+C on Mac) to copy the selected script.'}}</script></html>`;
fs.writeFileSync(path.join(output, "Start here.html"), html);
fs.copyFileSync(
  path.join(__dirname, "../README.md"),
  path.join(output, "README.md"),
);
console.log(output);

fs.copyFileSync(
  path.join(__dirname, "../LICENSE"),
  path.join(output, "LICENSE"),
);

fs.mkdirSync(path.join(output, "docs"), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, "../docs/behavior.md"),
  path.join(output, "docs/behavior.md"),
);
