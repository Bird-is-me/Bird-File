import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { runBirdProgram } from "./bird-language.mjs";

const SUPABASE_URL = "https://nwbsosabmknpeyxoqskm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_QSQA-DJBHVz2F4v6uwhy7Q_KhuaTHZ5";
const BUCKET = "bird-files";
const SIGNED_URL_SECONDS = 60;
const SETTINGS_STORAGE_KEY = "bird-files-dashboard-settings";
const TEXT_EXTENSIONS = new Set([
  "bird", "c", "cpp", "cs", "csv", "css", "go", "html", "java", "js", "jsx", "json", "kt", "md", "php", "py", "rb", "rs", "sh", "sql", "svg", "swift", "toml", "ts", "tsx", "txt", "xml", "yaml", "yml",
]);
const CODEMIRROR_BASE = "https://cdn.jsdelivr.net/npm/codemirror@5.65.16";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const signInForm = document.querySelector("#sign-in-form");
const signInButton = document.querySelector("#sign-in-button");
const signUpButton = document.querySelector("#sign-up-button");
const authMessage = document.querySelector("#auth-message");
const statusMessage = document.querySelector("#status-message");
const fileInput = document.querySelector("#file-input");
const folderInput = document.querySelector("#folder-input");
const fileList = document.querySelector("#file-list");
const fileTable = document.querySelector("#file-table");
const emptyState = document.querySelector("#empty-state");
const fileCount = document.querySelector("#file-count");
const searchInput = document.querySelector("#search-input");
const previewDialog = document.querySelector("#preview-dialog");
const previewContent = document.querySelector("#preview-content");
const editorDialog = document.querySelector("#editor-dialog");
const editorContent = document.querySelector("#editor-content");
const birdProgramTextarea = document.querySelector("#bird-program-editor");
const birdProgramOutput = document.querySelector("#bird-program-output");
const birdProgramName = document.querySelector("#bird-program-name");
const birdFileTab = document.querySelector("#bird-file-tab");
const createFileDialog = document.querySelector("#create-file-dialog");
const createFileForm = document.querySelector("#create-file-form");
const pageSections = [...document.querySelectorAll("[data-page-section]")];
const pageButtons = [...document.querySelectorAll("[data-page-target]")];

let currentUser = null;
let files = [];
let editingFile = null;
let editorInstance = null;
let previewEditor = null;
let birdProgramEditor = null;
let birdProgramEditorPromise = null;
let pendingBirdInputCancel = null;
let codeMirrorPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the code editor library."));
    document.head.append(script);
  });
}

async function loadCodeMirror() {
  if (window.CodeMirror) return window.CodeMirror;
  if (!codeMirrorPromise) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `${CODEMIRROR_BASE}/lib/codemirror.css`;
    document.head.append(stylesheet);

    codeMirrorPromise = (async () => {
      const modes = [
        "lib/codemirror.js",
        "mode/xml/xml.js",
        "mode/javascript/javascript.js",
        "mode/css/css.js",
        "mode/clike/clike.js",
        "mode/python/python.js",
        "mode/htmlmixed/htmlmixed.js",
      ];
      for (const mode of modes) await loadScript(`${CODEMIRROR_BASE}/${mode}`);
      window.CodeMirror.defineMode("bird", () => ({
        token(stream) {
          if (stream.eatSpace()) return null;
          if (stream.match(/#.*/)) return "comment";
          if (stream.match(/(?:let|print|input|fbs|r|s|e|v|if|elif|else|and|or|not|True|False)\b/)) return "keyword";
          if (stream.match(/"(?:\\.|[^"\\])*"/)) return "string";
          if (stream.match(/\b\d+(?:\.\d+)?\b/)) return "number";
          if (stream.match(/(?:==|!=|<=|>=|[=.+*/()[\],<>!:-])/)) return "operator";
          if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) return "variable";
          stream.next();
          return null;
        },
      }));
      return window.CodeMirror;
    })();
  }
  return codeMirrorPromise;
}

function showMessage(element, message, kind = "") {
  element.textContent = message;
  element.classList.toggle("message-error", kind === "error");
  element.classList.toggle("message-success", kind === "success");
}

function storageErrorMessage(error, operation = "insert") {
  if (/bucket not found|nosuchbucket/i.test(error?.message ?? "")) {
    return 'Private bucket "bird-files" is missing. Run supabase/migrations/202611160001_private_file_storage.sql in the Supabase SQL Editor, then refresh.';
  }
  if (/row-level security|violates row-level/i.test(error?.message ?? "")) {
    if (operation === "update") {
      return 'Save is blocked by Storage permissions. Add an UPDATE policy on storage.objects for authenticated users. Set both USING and WITH CHECK to: bucket_id = \'bird-files\' AND (storage.foldername(name))[1] = auth.uid()::text';
    }
    if (operation === "select") {
      return 'File listing is blocked by Storage permissions. Add a SELECT policy on storage.objects for authenticated users with this USING condition: bucket_id = \'bird-files\' AND (storage.foldername(name))[1] = auth.uid()::text';
    }
    return 'Upload is blocked by Storage permissions. In Supabase Storage > Policies, add an INSERT policy on storage.objects for authenticated users with this WITH CHECK: bucket_id = \'bird-files\' AND (storage.foldername(name))[1] = auth.uid()::text';
  }
  return error?.message ?? "Unknown storage error.";
}

function setUser(user) {
  currentUser = user;
  authView.hidden = Boolean(user);
  appView.hidden = !user;
  files = [];
  fileList.replaceChildren();
  if (user) {
    document.querySelector("#user-email").textContent = user.email ?? "Signed in";
    showMessage(statusMessage, "");
    loadDashboardSettings();
    window.setTimeout(() => void loadFiles(), 0);
  } else {
    document.querySelector("#user-email").textContent = "";
  }
}

function getExtension(name) {
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
}

function getFileTypeLabel(file) {
  const extension = getExtension(file.name);
  const labels = {
    bird: "BIRD", c: "CODE", cpp: "CODE", cs: "CODE", go: "CODE", html: "CODE", java: "CODE", js: "CODE", jsx: "CODE",
    kt: "CODE", php: "CODE", py: "CODE", rb: "CODE", rs: "CODE", sh: "CODE", sql: "CODE", swift: "CODE",
    tsx: "CODE", ts: "CODE", css: "CODE", txt: "TXT", md: "TEXT", csv: "CSV", json: "JSON", pdf: "PDF",
    png: "IMG", jpg: "IMG", jpeg: "IMG", gif: "IMG", webp: "IMG", svg: "SVG", zip: "ZIP", doc: "DOC",
    docx: "DOC", xls: "XLS", xlsx: "XLS", mp3: "AUDIO", wav: "AUDIO", mp4: "VIDEO", mov: "VIDEO",
  };
  return labels[extension] ?? extension.slice(0, 4).toUpperCase() ?? "FILE";
}

function getCodeMirrorMode(file) {
  const extension = getExtension(file.name);
  if (extension === "bird") return "bird";
  if (["html", "htm"].includes(extension)) return "htmlmixed";
  if (extension === "py") return "python";
  if (["js", "jsx", "ts", "tsx"].includes(extension)) return "javascript";
  if (extension === "css") return "css";
  if (extension === "json") return { name: "javascript", json: true };
  if (extension === "c") return "text/x-csrc";
  if (extension === "cpp") return "text/x-c++src";
  if (extension === "cs") return "text/x-csharp";
  if (extension === "java") return "text/x-java";
  return "text/plain";
}

function getMimeType(file) {
  if (file.metadata?.mimetype) return file.metadata.mimetype;
  const extension = getExtension(file.name);
  const types = {
    csv: "text/csv", css: "text/css", html: "text/html", js: "text/javascript",
    json: "application/json", md: "text/markdown", pdf: "application/pdf", py: "text/plain",
    svg: "image/svg+xml", ts: "text/plain", txt: "text/plain", xml: "text/xml",
  };
  return types[extension] ?? "application/octet-stream";
}

function isTextFile(file) {
  return getMimeType(file).startsWith("text/") ||
    getMimeType(file) === "application/json" || TEXT_EXTENSIONS.has(getExtension(file.name));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "--";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function createAction(label, className, handler, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `row-action ${className}`;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", handler);
  return button;
}

function renderFiles() {
  const query = searchInput.value.trim().toLowerCase();
  const visibleFiles = files.filter((file) => (file.relativeName ?? file.name).toLowerCase().includes(query));
  fileList.replaceChildren();
  fileTable.hidden = visibleFiles.length === 0;
  emptyState.hidden = visibleFiles.length !== 0 || files.length !== 0;
  fileCount.textContent = files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : "";

  if (files.length && !visibleFiles.length) {
    fileTable.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector("h2").textContent = "No matches found";
    emptyState.querySelector("p").textContent = "Try another filename.";
    document.querySelector("#empty-upload-button").hidden = true;
    return;
  }

  emptyState.querySelector("h2").textContent = "No files here yet";
  emptyState.querySelector("p").textContent = "Upload a file to start building your private library.";
  document.querySelector("#empty-upload-button").hidden = false;

  const fragment = document.createDocumentFragment();
  for (const file of visibleFiles) {
    const row = document.createElement("article");
    row.className = "file-row";

    const nameCell = document.createElement("div");
    nameCell.className = "file-name-cell";
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = getFileTypeLabel(file) || "FILE";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.relativeName ?? file.name;
    name.title = file.relativeName ?? file.name;
    nameCell.append(icon, name);

    const modified = document.createElement("span");
    modified.className = "file-date";
    modified.textContent = formatDate(file.updated_at ?? file.created_at);

    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = formatBytes(Number(file.metadata?.size));

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const menu = document.createElement("details");
    menu.className = "file-menu";
    const menuTrigger = document.createElement("summary");
    menuTrigger.setAttribute("aria-label", `Actions for ${file.name}`);
    menuTrigger.textContent = "⋯";
    const menuPanel = document.createElement("div");
    menuPanel.className = "file-menu-panel";
    for (const [label, handler, disabled] of [
      ["Preview", () => void previewFile(file), false],
      ["Edit file", () => void editFile(file), !isTextFile(file)],
      ["Download", () => void downloadFile(file), false],
    ]) {
      const menuButton = document.createElement("button");
      menuButton.type = "button";
      menuButton.className = "file-menu-button";
      menuButton.textContent = label;
      menuButton.disabled = disabled;
      menuButton.addEventListener("click", () => {
        menu.open = false;
        handler();
      });
      menuPanel.append(menuButton);
    }
    menu.append(menuTrigger, menuPanel);
    actions.append(menu);

    row.append(nameCell, modified, size, actions);
    fragment.append(row);
  }
  fileList.append(fragment);
}

async function loadFiles() {
  if (!currentUser) return;
  showMessage(statusMessage, "Loading files...");
  try {
    files = await listFilesRecursively(currentUser.id, "");
  } catch (error) {
    showMessage(statusMessage, `Could not load files: ${storageErrorMessage(error, "select")}`, "error");
    return;
  }

  showMessage(statusMessage, "");
  renderFiles();
}

async function listFilesRecursively(storagePrefix, relativePrefix) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(storagePrefix, { limit: 100, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;

  const foundFiles = [];
  for (const entry of data ?? []) {
    const objectPath = `${storagePrefix}/${entry.name}`;
    if (!entry.id) {
      foundFiles.push(...await listFilesRecursively(objectPath, `${relativePrefix}${entry.name}/`));
    } else {
      foundFiles.push({
        ...entry,
        objectPath,
        relativeName: `${relativePrefix}${entry.name}`,
      });
    }
  }
  return foundFiles;
}

function storagePath(file) {
  return file.objectPath ?? `${currentUser.id}/${file.name}`;
}

async function uploadFiles(selectedFiles) {
  if (!currentUser || !selectedFiles.length) return;
  const uploadButtons = [document.querySelector("#upload-button"), document.querySelector("#upload-folder-button")];
  uploadButtons.forEach((button) => { button.disabled = true; });
  let uploaded = 0;

  for (const file of selectedFiles) {
    const relativePath = file.webkitRelativePath || file.name;
    const safePath = relativePath.split(/[\\/]/).map((part) => part.replace(/^\.+/, "").trim()).filter(Boolean).join("/");
    if (!safePath) continue;
    showMessage(statusMessage, `Uploading ${safePath}...`);
    const { error } = await supabase.storage.from(BUCKET).upload(
      `${currentUser.id}/${safePath}`,
      file,
      { contentType: file.type || "application/octet-stream", upsert: false },
    );
    if (error) {
      showMessage(statusMessage, `Could not upload ${safePath}: ${storageErrorMessage(error)}`, "error");
      uploadButtons.forEach((button) => { button.disabled = false; });
      return;
    }
    uploaded += 1;
  }

  showMessage(statusMessage, `${uploaded} ${uploaded === 1 ? "file" : "files"} uploaded.`, "success");
  uploadButtons.forEach((button) => { button.disabled = false; });
  fileInput.value = "";
  folderInput.value = "";
  await loadFiles();
}

async function createTextFile(event) {
  event.preventDefault();
  if (!currentUser) return;
  const nameInput = document.querySelector("#new-file-name");
  const safeName = nameInput.value.trim();
  const message = document.querySelector("#create-file-message");
  if (!safeName || /[\\/]/.test(safeName) || safeName === "." || safeName === "..") {
    showMessage(message, "Enter a file name without folder separators.", "error");
    return;
  }

  const button = document.querySelector("#save-new-file-button");
  button.disabled = true;
  showMessage(message, "Creating file...");
  const contentType = getMimeType({ name: safeName, metadata: {} });
  const blob = new Blob([document.querySelector("#new-file-content").value], { type: contentType });
  const { error } = await supabase.storage.from(BUCKET).upload(
    `${currentUser.id}/${safeName}`,
    blob,
    { contentType, upsert: false },
  );
  button.disabled = false;

  if (error) {
    showMessage(message, `Could not create file: ${storageErrorMessage(error)}`, "error");
    return;
  }

  createFileForm.reset();
  createFileDialog.close();
  showMessage(statusMessage, "File created.", "success");
  await loadFiles();
}

function readDashboardSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function loadDashboardSettings() {
  const settings = readDashboardSettings();
  document.querySelector("#site-domain-input").value = settings.siteDomain ?? "";
  document.querySelector("#control-panel-input").value = settings.controlPanelUrl ?? "";
  document.querySelector("#hosting-domain-label").textContent = settings.siteDomain || "No domain set";
}

function getSafeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function openDashboardUrl(value, message, missingMessage) {
  const url = getSafeHttpUrl(value);
  if (!url) {
    showMessage(message, missingMessage, "error");
    return;
  }
  window.open(url.href, "_blank", "noopener,noreferrer");
  showMessage(message, "Opened in a new tab.", "success");
}

function showDashboardPage(pageName) {
  for (const section of pageSections) section.hidden = section.dataset.pageSection !== pageName;
  for (const button of pageButtons) {
    const active = button.dataset.pageTarget === pageName;
    button.classList.toggle("nav-link-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }

  const titles = { files: "Files", hosting: "Hosting", database: "Database", settings: "Settings", "bird-program": "Bird Program" };
  document.querySelector("#view-title").textContent = titles[pageName] ?? "Files";
  if (pageName === "files") void loadFiles();
  if (pageName === "settings") loadDashboardSettings();
  if (pageName === "bird-program") void setupBirdProgramEditor();
}

async function setupBirdProgramEditor() {
  if (birdProgramEditor) {
    birdProgramEditor.refresh();
    return;
  }
  if (!birdProgramEditorPromise) {
    birdProgramEditorPromise = (async () => {
      const CodeMirror = await loadCodeMirror();
      birdProgramEditor = CodeMirror.fromTextArea(birdProgramTextarea, {
        mode: "bird",
        theme: "monochrome",
        lineNumbers: true,
        lineWrapping: false,
        indentUnit: 2,
        tabSize: 2,
      });
      birdProgramEditor.refresh();
    })().catch((error) => {
      birdProgramEditorPromise = null;
      birdProgramOutput.textContent = `Editor failed to load: ${error.message}`;
      birdProgramOutput.classList.add("program-error");
    });
  }
  await birdProgramEditorPromise;
}

async function executeBirdProgram() {
  await setupBirdProgramEditor();
  if (!birdProgramEditor) return;
  birdProgramOutput.replaceChildren();
  const runButton = document.querySelector("#run-bird-program");
  runButton.disabled = true;
  try {
    let hasOutput = false;
    await runBirdProgram(birdProgramEditor.getValue(), {
      onOutput(value) {
        hasOutput = true;
        const line = document.createElement("div");
        line.className = "bird-output-line";
        line.textContent = value;
        birdProgramOutput.append(line);
        birdProgramOutput.scrollTop = birdProgramOutput.scrollHeight;
      },
      readInput: requestBirdInput,
    });
    if (!hasOutput) {
      const line = document.createElement("div");
      line.className = "bird-output-line bird-muted";
      line.textContent = "(no output)";
      birdProgramOutput.append(line);
    }
  } catch (error) {
    if (error.message === "Bird run cancelled.") return;
    const line = document.createElement("div");
    line.className = "bird-output-line program-error";
    line.textContent = error.message;
    birdProgramOutput.append(line);
  } finally {
    runButton.disabled = false;
  }
}

function requestBirdInput(prompt) {
  return new Promise((resolve, reject) => {
    const form = document.createElement("form");
    form.className = "bird-input-request";
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.setAttribute("aria-label", prompt || "Program input");
    input.placeholder = "Type a value and press Enter";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "button button-quiet";
    submit.textContent = "Send";
    form.append(input, submit);
    let settled = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      settled = true;
      pendingBirdInputCancel = null;
      const value = input.value;
      const line = document.createElement("div");
      line.className = "bird-output-line bird-input-value";
      line.textContent = value;
      form.replaceWith(line);
      resolve(value);
    }, { once: true });
    pendingBirdInputCancel = () => {
      if (settled) return;
      settled = true;
      form.remove();
      pendingBirdInputCancel = null;
      reject(new Error("Bird run cancelled."));
    };
    birdProgramOutput.append(form);
    input.focus();
    birdProgramOutput.scrollTop = birdProgramOutput.scrollHeight;
  });
}

async function saveBirdProgram() {
  if (!currentUser) return;
  await setupBirdProgramEditor();
  if (!birdProgramEditor) return;
  let name = birdProgramName.value.trim();
  if (!name || /[\\/]/.test(name) || name === "." || name === "..") {
    showMessage(document.querySelector("#bird-save-message"), "Enter a valid file name without folder separators.", "error");
    return;
  }
  if (!name.toLowerCase().endsWith(".bird")) name += ".bird";

  const button = document.querySelector("#save-bird-program");
  button.disabled = true;
  const content = new Blob([birdProgramEditor.getValue()], { type: "text/plain;charset=utf-8" });
  const objectPath = `${currentUser.id}/${name}`;
  const existingFile = files.find((file) => file.objectPath === objectPath);
  const result = existingFile
    ? await supabase.storage.from(BUCKET).update(objectPath, content, { contentType: "text/plain" })
    : await supabase.storage.from(BUCKET).upload(objectPath, content, { contentType: "text/plain", upsert: false });
  const { error } = result;
  button.disabled = false;
  if (error) {
    showMessage(document.querySelector("#bird-save-message"), `Could not save program: ${storageErrorMessage(error)}`, "error");
    return;
  }

  birdProgramName.value = name;
  birdFileTab.textContent = name;
  showMessage(document.querySelector("#bird-save-message"), `Saved ${name} to your private files.`, "success");
  await loadFiles();
}

async function getSignedUrl(file, download = false) {
  const options = download ? { download: file.name } : undefined;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath(file), SIGNED_URL_SECONDS, options);
  if (error) throw error;
  return data.signedUrl;
}

async function downloadFile(file) {
  try {
    window.location.assign(await getSignedUrl(file, true));
  } catch (error) {
    showMessage(statusMessage, `Could not download file: ${error.message}`, "error");
  }
}

function createPreviewToolbar(file, description, downloadLabel) {
  const toolbar = document.createElement("div");
  toolbar.className = "preview-toolbar";
  const note = document.createElement("span");
  note.textContent = description;
  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "button button-quiet";
  downloadButton.textContent = downloadLabel;
  downloadButton.addEventListener("click", () => void downloadFile(file));
  toolbar.append(note, downloadButton);
  return toolbar;
}

async function signPrivateAsset(reference, relativeTo) {
  if (/^(?:#|data:|blob:|javascript:|mailto:)/i.test(reference.trim())) return reference;
  let resolved;
  try {
    const encodedPath = `${currentUser.id}/${relativeTo.split("/").map(encodeURIComponent).join("/")}`;
    const base = new URL(encodedPath, "https://bird-files-preview.invalid/");
    resolved = new URL(reference, base);
    if (resolved.origin !== base.origin) return reference;
  } catch {
    return null;
  }

  const assetPath = decodeURIComponent(resolved.pathname.replace(/^\/+/, ""));
  const asset = files.find((candidate) => candidate.objectPath === assetPath);
  if (!asset) return null;

  const signed = new URL(await getSignedUrl(asset));
  resolved.searchParams.forEach((value, key) => signed.searchParams.set(key, value));
  signed.hash = resolved.hash;
  return signed.href;
}

function findPrivateAsset(reference, relativeTo) {
  try {
    const encodedPath = `${currentUser.id}/${relativeTo.split("/").map(encodeURIComponent).join("/")}`;
    const base = new URL(encodedPath, "https://bird-files-preview.invalid/");
    const resolved = new URL(reference, base);
    if (resolved.origin !== base.origin) return null;
    const assetPath = decodeURIComponent(resolved.pathname.replace(/^\/+/, ""));
    return files.find((candidate) => candidate.objectPath === assetPath) ?? null;
  } catch {
    return null;
  }
}

async function rewriteCssAssetUrls(source, cssFile) {
  const references = [...source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)];
  let rewritten = source;
  for (const match of references) {
    const reference = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const signedUrl = await signPrivateAsset(reference, cssFile.relativeName ?? cssFile.name);
    if (signedUrl && signedUrl !== reference) {
      const escapedUrl = signedUrl.replace(/"/g, "%22");
      rewritten = rewritten.replace(match[0], `url("${escapedUrl}")`);
    }
  }
  return rewritten;
}

async function prepareHtmlPreview(source, htmlFile) {
  const documentPreview = new DOMParser().parseFromString(source, "text/html");
  const htmlPath = htmlFile.relativeName ?? htmlFile.name;
  const resourceSelectors = [
    ["script[src]", "src"],
    ['link[rel~="stylesheet"][href]', "href"],
    ["img[src]", "src"],
    ["source[src]", "src"],
    ["video[src], audio[src]", "src"],
    ["video[poster]", "poster"],
  ];

  for (const link of documentPreview.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const reference = link.getAttribute("href");
    const stylesheetFile = findPrivateAsset(reference, htmlPath);
    if (!stylesheetFile) continue;
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath(stylesheetFile));
    if (error) throw error;
    const style = documentPreview.createElement("style");
    style.textContent = await rewriteCssAssetUrls(await data.text(), stylesheetFile);
    link.replaceWith(style);
  }

  for (const [selector, attribute] of resourceSelectors) {
    if (selector.startsWith("link[")) continue;
    for (const element of documentPreview.querySelectorAll(selector)) {
      const reference = element.getAttribute(attribute);
      const signedUrl = await signPrivateAsset(reference, htmlPath);
      if (signedUrl) element.setAttribute(attribute, signedUrl);
      else element.removeAttribute(attribute);
    }
  }

  for (const style of documentPreview.querySelectorAll("style")) {
    style.textContent = await rewriteCssAssetUrls(style.textContent, { relativeName: htmlPath });
  }
  for (const element of documentPreview.querySelectorAll("[style]")) {
    element.setAttribute("style", await rewriteCssAssetUrls(element.getAttribute("style"), { relativeName: htmlPath }));
  }

  const base = documentPreview.createElement("base");
  base.href = "https://bird-files-preview.invalid/";
  documentPreview.head.prepend(base);
  return `<!doctype html>${documentPreview.documentElement.outerHTML}`;
}

async function showCodePreview(file, source, description, downloadLabel) {
  const toolbar = createPreviewToolbar(file, description, downloadLabel);
  const codeHost = document.createElement("div");
  codeHost.className = "code-preview";
  previewContent.replaceChildren(toolbar, codeHost);
  const CodeMirror = await loadCodeMirror();
  previewEditor = CodeMirror(codeHost, {
    value: source,
    mode: getCodeMirrorMode(file),
    theme: "monochrome",
    readOnly: "nocursor",
    lineNumbers: true,
    lineWrapping: true,
    viewportMargin: Infinity,
  });
}

async function previewFile(file) {
  previewContent.replaceChildren();
  document.querySelector("#preview-title").textContent = file.name;
  previewDialog.showModal();
  const mimeType = getMimeType(file);
  const extension = getExtension(file.name);

  try {
    if (["html", "htm"].includes(extension)) {
      const { data, error } = await supabase.storage.from(BUCKET).download(storagePath(file));
      if (error) throw error;
      const frame = document.createElement("iframe");
      frame.className = "html-preview";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.title = `HTML preview of ${file.name}`;
      frame.srcdoc = await prepareHtmlPreview(await data.text(), file);
      previewContent.append(createPreviewToolbar(file, "Sandbox preview; linked private JS/CSS files are loaded.", "Download HTML"), frame);
      return;
    }

    if (isTextFile(file)) {
      const { data, error } = await supabase.storage.from(BUCKET).download(storagePath(file));
      if (error) throw error;
      const source = await data.text();
      if (extension === "py") {
        await showCodePreview(file, source, "Run locally with: python3 " + file.name, "Download Python");
      } else if (["js", "jsx", "ts", "tsx"].includes(extension)) {
        await showCodePreview(file, source, "JavaScript is shown, not executed.", "Download JavaScript");
      } else {
        await showCodePreview(file, source, `${getFileTypeLabel(file)} source`, `Download ${getExtension(file).toUpperCase() || "file"}`);
      }
      return;
    }

    const url = await getSignedUrl(file);
    if (mimeType.startsWith("image/")) {
      const image = document.createElement("img");
      image.className = "image-preview";
      image.src = url;
      image.alt = file.name;
      previewContent.append(image);
    } else if (mimeType === "application/pdf") {
      const frame = document.createElement("iframe");
      frame.className = "document-preview";
      frame.src = url;
      frame.title = file.name;
      previewContent.append(frame);
    } else if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
      const media = document.createElement(mimeType.startsWith("video/") ? "video" : "audio");
      media.className = "media-preview";
      media.src = url;
      media.controls = true;
      previewContent.append(media);
    } else {
      const note = document.createElement("p");
      note.className = "preview-note";
      note.textContent = "Preview is not available for this file type. Use Download to open it.";
      previewContent.append(note);
    }
  } catch (error) {
    const note = document.createElement("p");
    note.className = "preview-note message-error";
    note.textContent = `Could not preview file: ${error.message}`;
    previewContent.append(note);
  }
}

async function editFile(file) {
  if (!isTextFile(file)) return;
  showMessage(statusMessage, `Opening ${file.name}...`);
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath(file));
  if (error) {
    showMessage(statusMessage, `Could not open file: ${error.message}`, "error");
    return;
  }

  try {
    const CodeMirror = await loadCodeMirror();
    editingFile = file;
    document.querySelector("#editor-title").textContent = file.name;
    editorContent.value = await data.text();
    editorInstance?.toTextArea();
    editorInstance = CodeMirror.fromTextArea(editorContent, {
      mode: getCodeMirrorMode(file),
      theme: "monochrome",
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
    });
    showMessage(document.querySelector("#editor-message"), "");
    showMessage(statusMessage, "");
    editorDialog.showModal();
    editorInstance.refresh();
    editorInstance.focus();
  } catch (error) {
    showMessage(statusMessage, `Could not open code editor: ${error.message}`, "error");
  }
}

async function saveEditedFile(event) {
  event.preventDefault();
  if (!editingFile || !currentUser) return;
  const saveButton = document.querySelector("#save-edit-button");
  saveButton.disabled = true;
  showMessage(document.querySelector("#editor-message"), "Saving...");
  const mimeType = getMimeType(editingFile);
  const blob = new Blob([editorInstance?.getValue() ?? editorContent.value], { type: mimeType });
  let error;
  try {
    ({ error } = await supabase.storage.from(BUCKET).update(
      storagePath(editingFile),
      blob,
      { contentType: mimeType },
    ));
  } catch (saveError) {
    error = saveError;
  } finally {
    saveButton.disabled = false;
  }

  if (error) {
    showMessage(document.querySelector("#editor-message"), `Could not save: ${storageErrorMessage(error, "update")}`, "error");
    return;
  }

  editorDialog.close();
  showMessage(statusMessage, "Changes saved.", "success");
  await loadFiles();
}

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  signInButton.disabled = true;
  showMessage(authMessage, "Signing in...");
  const formData = new FormData(signInForm);
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")).trim(),
    password: String(formData.get("password")),
  });
  signInButton.disabled = false;
  if (error) showMessage(authMessage, error.message, "error");
});

signUpButton.addEventListener("click", async () => {
  if (!signInForm.reportValidity()) return;

  const formData = new FormData(signInForm);
  const email = String(formData.get("email")).trim();
  const password = String(formData.get("password"));
  if (password.length < 8) {
    showMessage(authMessage, "Use a password with at least 8 characters.", "error");
    return;
  }

  signUpButton.disabled = true;
  signInButton.disabled = true;
  showMessage(authMessage, "Creating your account...");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  signUpButton.disabled = false;
  signInButton.disabled = false;

  if (error) {
    showMessage(authMessage, error.message, "error");
  } else if (data.session) {
    showMessage(authMessage, "Account created. Opening your files...", "success");
  } else {
    showMessage(authMessage, "Account created. Check your email to confirm, then sign in.", "success");
  }
});

document.querySelector("#sign-out-button").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) showMessage(statusMessage, `Could not sign out: ${error.message}`, "error");
});

document.querySelector("#upload-button").addEventListener("click", () => fileInput.click());
document.querySelector("#empty-upload-button").addEventListener("click", () => fileInput.click());
document.querySelector("#upload-folder-button").addEventListener("click", () => folderInput.click());
document.querySelector("#refresh-button").addEventListener("click", () => void loadFiles());
fileInput.addEventListener("change", () => void uploadFiles(Array.from(fileInput.files ?? [])));
folderInput.addEventListener("change", () => void uploadFiles(Array.from(folderInput.files ?? [])));
searchInput.addEventListener("input", renderFiles);
document.querySelector("#edit-form").addEventListener("submit", saveEditedFile);
document.querySelector("#close-preview").addEventListener("click", () => previewDialog.close());
document.querySelector("#close-editor").addEventListener("click", () => editorDialog.close());
document.querySelector("#create-file-button").addEventListener("click", () => createFileDialog.showModal());
document.querySelector("#close-create-file").addEventListener("click", () => createFileDialog.close());
createFileForm.addEventListener("submit", createTextFile);
for (const button of pageButtons) {
  button.addEventListener("click", () => showDashboardPage(button.dataset.pageTarget));
}
document.querySelector("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const siteValue = document.querySelector("#site-domain-input").value.trim();
  const panelValue = document.querySelector("#control-panel-input").value.trim();
  const siteUrl = siteValue ? getSafeHttpUrl(siteValue) : null;
  const panelUrl = panelValue ? getSafeHttpUrl(panelValue) : null;
  if ((siteValue && !siteUrl) || (panelValue && !panelUrl)) {
    showMessage(document.querySelector("#settings-message"), "Enter valid http:// or https:// URLs.", "error");
    return;
  }

  const settings = { siteDomain: siteUrl?.href ?? "", controlPanelUrl: panelUrl?.href ?? "" };
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  document.querySelector("#hosting-domain-label").textContent = settings.siteDomain || "No domain set";
  showMessage(document.querySelector("#settings-message"), "Settings saved in this browser.", "success");
});

function openCpanel() {
  const settings = readDashboardSettings();
  openDashboardUrl(
    settings.controlPanelUrl,
    document.querySelector("#hosting-message"),
    "Add your cPanel URL in Settings first.",
  );
}

function openSiteDomain() {
  const settings = readDashboardSettings();
  openDashboardUrl(
    settings.siteDomain,
    document.querySelector("#hosting-message"),
    "Add your website URL in Settings first.",
  );
}

document.querySelector("#create-hosting-button").addEventListener("click", openCpanel);
document.querySelector("#create-subdomain-button").addEventListener("click", openCpanel);
document.querySelector("#domain-dashboard-button").addEventListener("click", openCpanel);
document.querySelector("#open-cpanel-button").addEventListener("click", openCpanel);
document.querySelector("#go-to-domain-button").addEventListener("click", openSiteDomain);
document.querySelector("#build-domain-button").addEventListener("click", openSiteDomain);
document.querySelector("#run-bird-program").addEventListener("click", () => void executeBirdProgram());
document.querySelector("#clear-bird-output").addEventListener("click", () => {
  pendingBirdInputCancel?.();
  birdProgramOutput.replaceChildren();
  birdProgramOutput.classList.remove("program-error");
});
document.querySelector("#save-bird-program").addEventListener("click", () => void saveBirdProgram());
birdProgramName.addEventListener("input", () => {
  birdFileTab.textContent = birdProgramName.value.trim() || "untitled.bird";
});
editorDialog.addEventListener("close", () => {
  editorInstance?.toTextArea();
  editorInstance = null;
  editingFile = null;
});
previewDialog.addEventListener("close", () => {
  previewEditor?.getWrapperElement().remove();
  previewEditor = null;
  previewContent.replaceChildren();
});

supabase.auth.onAuthStateChange((_event, session) => {
  setUser(session?.user ?? null);
});