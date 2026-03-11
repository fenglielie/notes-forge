const appEl = document.querySelector(".app");
const treeContainer = document.getElementById("tree");
const viewer = document.getElementById("viewer");
const meta = document.getElementById("meta");
const tocContainer = document.getElementById("toc");
const mobileTitle = document.getElementById("mobileTitle");
const sidebar = document.querySelector(".sidebar");
const tocSidebar = document.querySelector(".toc-sidebar");
const leftResizer = document.getElementById("leftResizer");
const rightResizer = document.getElementById("rightResizer");
const backdrop = document.getElementById("mobileBackdrop");
const openTreeBtn = document.getElementById("openTreeBtn");
const openTocBtn = document.getElementById("openTocBtn");
const openTreeDesktopBtn = document.getElementById("openTreeDesktopBtn");
const openTocDesktopBtn = document.getElementById("openTocDesktopBtn");
const closeTreeBtn = document.getElementById("closeTreeBtn");
const closeTocBtn = document.getElementById("closeTocBtn");
const collapseTreeBtn = document.getElementById("collapseTreeBtn");
const refreshTreeBtn = document.getElementById("refreshTreeBtn");
const openSearchBtn = document.getElementById("openSearchBtn");
const downloadBtn = document.getElementById("downloadBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const searchOverlay = document.getElementById("searchOverlay");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const backendStatusBanner = document.getElementById("backendStatusBanner");
const backendStatusText = document.getElementById("backendStatusText");
const backendRetryBtn = document.getElementById("backendRetryBtn");
const contentEl = document.querySelector(".content");
const hljsLightTheme = document.getElementById("hljsLightTheme");
const hljsDarkTheme = document.getElementById("hljsDarkTheme");
const articleWrapper = document.querySelector(".article-wrapper");
const fixedFooter = document.getElementById("fixedFooter");
const runtimeConfig = window.NOTES_FORGE_CONFIG || {};
const hideTreeUi = !!runtimeConfig.hideTree;
const hideTocUi = !!runtimeConfig.hideToc;
const enableSearchUi = !!runtimeConfig.enableSearch;
const enableDownloadUi = !!runtimeConfig.enableDownload;
const enableThemeUi = !!runtimeConfig.enableTheme;
const serveModeUi = !!runtimeConfig.serveMode;
const footerText = typeof runtimeConfig.footerText === "string"
    ? runtimeConfig.footerText.trim()
    : "";

let currentFilePath = null;
const mobileMedia = window.matchMedia("(max-width: 900px)");
const STORAGE_KEY = "md-browser-reading-state";
const THEME_KEY = "md-browser-theme";
const LAYOUT_KEY = "md-browser-desktop-layout";
const BASE_TITLE = "Notes Forge";
const MIN_LEFT_SIDEBAR = 220;
const MAX_LEFT_SIDEBAR = 560;
const MIN_RIGHT_SIDEBAR = 220;
const MAX_RIGHT_SIDEBAR = 520;
const DESKTOP_DOCKED_CONTENT_MIN = 960;
const DESKTOP_RESIZER_SIZE = 18;
let scrollSaveTimer = null;
let hljsReadyPromise = null;
let currentPdfBlobUrl = null;
let pdfjsReadyPromise = null;
let activePdfDoc = null;
let activePdfScale = 1;
let pdfRenderInFlight = false;
let currentPdfSourceUrl = "";
let currentPdfTitle = "";
let currentPdfViewMode = "native";
let currentTreeData = [];
let searchableFiles = [];
const searchContentCache = new Map();
let searchIndexBuildPromise = null;
const HLJS_VERSION = "11.8.0";
const REQUIRED_HLJS_LANGS = [
    { name: "c", url: `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/languages/c.min.js` },
    { name: "cpp", url: `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/languages/cpp.min.js` },
    { name: "python", url: `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/languages/python.min.js` },
    { name: "matlab", url: `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/languages/matlab.min.js` },
    { name: "tex", url: `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/languages/latex.min.js` },
];
const HLJS_LANGUAGE_ALIASES = {
    "c++": "cpp",
    cc: "cpp",
    cxx: "cpp",
    py: "python",
    python3: "python",
    matlab: "matlab",
    tex: "tex",
    latex: "tex",
};
const CURRENT_FILE_HIT_LIMIT = 5;
const OTHER_FILE_HIT_LIMIT = 2;

function getBackendHealthUrl() {
    return new URL("__healthz", window.location.href).toString();
}

marked.setOptions({
    langPrefix: "hljs language-"
});

function protectDisplayMathBlocks(markdownText) {
    const source = typeof markdownText === "string" ? markdownText : "";
    const blocks = [];
    const mathEnvironmentNames = new Set([
        "equation", "equation*",
        "align", "align*",
        "aligned",
        "gather", "gather*",
        "multline", "multline*",
        "flalign", "flalign*",
        "alignat", "alignat*",
        "eqnarray", "eqnarray*",
        "split",
    ]);
    const environmentPattern = /\\begin\{([a-zA-Z]+(?:\*)?)\}[\s\S]*?\\end\{\1\}/g;
    const delimitedPattern = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g;
    const storeBlock = (match) => {
        const token = `@@NF_MATH_BLOCK_${blocks.length}@@`;
        blocks.push(match);
        return token;
    };
    const protectedEnvironments = source.replace(environmentPattern, (match, envName) => {
        if (!mathEnvironmentNames.has(envName)) {
            return match;
        }
        return storeBlock(match);
    });
    const protectedText = protectedEnvironments.replace(delimitedPattern, storeBlock);
    return { protectedText, blocks };
}

function restoreProtectedBlocks(text, blocks, tokenPrefix) {
    let output = typeof text === "string" ? text : "";
    blocks.forEach((block, idx) => {
        const token = `@@NF_${tokenPrefix}_${idx}@@`;
        output = output.split(token).join(block);
    });
    return output;
}

function protectCodeSpansAndFences(markdownText) {
    const source = typeof markdownText === "string" ? markdownText : "";
    const blocks = [];
    const pattern = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;
    const protectedText = source.replace(pattern, (match) => {
        const token = `@@NF_CODE_BLOCK_${blocks.length}@@`;
        blocks.push(match);
        return token;
    });
    return { protectedText, blocks };
}

function restoreDisplayMathBlocks(html, blocks) {
    return restoreProtectedBlocks(html, blocks, "MATH_BLOCK");
}

function parseMarkdownWithDisplayMath(markdownText) {
    const { protectedText: codeSafeText, blocks: codeBlocks } = protectCodeSpansAndFences(markdownText);
    const { protectedText: mathProtectedText, blocks: mathBlocks } = protectDisplayMathBlocks(codeSafeText);
    const markdownForParse = restoreProtectedBlocks(mathProtectedText, codeBlocks, "CODE_BLOCK");
    const html = marked.parse(markdownForParse);
    return restoreDisplayMathBlocks(html, mathBlocks);
}

function setBackendOffline(message) {
    if (!serveModeUi || !backendStatusBanner || !backendStatusText) return;
    backendStatusText.textContent = message;
    backendStatusBanner.hidden = false;
}

function setBackendOnline() {
    if (!backendStatusBanner) return;
    backendStatusBanner.hidden = true;
}

async function probeBackendHealth(manual = false) {
    if (!serveModeUi) return;
    try {
        const response = await fetch(getBackendHealthUrl(), { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setBackendOnline();
    } catch {
        if (manual) {
            const hint = "Backend disconnected. Restart `notes-forge serve`, then refresh.";
            setBackendOffline(hint);
        }
    }
}

async function fetchWithBackendState(url, options) {
    try {
        const response = await fetch(url, options);
        if (serveModeUi && response.ok) {
            setBackendOnline();
        }
        return response;
    } catch (err) {
        if (serveModeUi) {
            await probeBackendHealth(true);
        }
        throw err;
    }
}

function ensureHljsReady() {
    if (window.hljs && typeof window.hljs.highlightElement === "function") {
        return ensureRequiredHljsLanguages();
    }
    if (hljsReadyPromise) return hljsReadyPromise;

    const cdnList = [
        `https://cdn.jsdelivr.net/npm/highlight.js@${HLJS_VERSION}/highlight.min.js`,
        `https://unpkg.com/highlight.js@${HLJS_VERSION}/lib/common.min.js`,
        `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HLJS_VERSION}/highlight.min.js`
    ];

    hljsReadyPromise = new Promise(resolve => {
        let idx = 0;
        const tryLoad = () => {
            if (window.hljs && typeof window.hljs.highlightElement === "function") {
                ensureRequiredHljsLanguages().then(resolve).catch(() => resolve(false));
                return;
            }
            if (idx >= cdnList.length) {
                resolve(false);
                return;
            }
            const script = document.createElement("script");
            script.src = cdnList[idx++];
            script.async = true;
            script.onload = () => {
                if (!(window.hljs && typeof window.hljs.highlightElement === "function")) {
                    resolve(false);
                    return;
                }
                ensureRequiredHljsLanguages().then(resolve).catch(() => resolve(false));
            };
            script.onerror = tryLoad;
            document.head.appendChild(script);
        };
        tryLoad();
    });
    return hljsReadyPromise;
}

function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

async function ensureRequiredHljsLanguages() {
    if (!(window.hljs && typeof window.hljs.getLanguage === "function")) {
        return false;
    }
    for (const language of REQUIRED_HLJS_LANGS) {
        if (window.hljs.getLanguage(language.name)) continue;
        try {
            await loadExternalScript(language.url);
        } catch {
            return false;
        }
    }
    return true;
}

function normalizeCodeLanguageClass(codeEl) {
    if (!codeEl || !codeEl.classList) return;
    const languageClass = Array.from(codeEl.classList).find((cls) => cls.startsWith("language-"));
    if (!languageClass) return;
    const rawLanguage = languageClass.slice("language-".length).toLowerCase();
    const normalizedLanguage = HLJS_LANGUAGE_ALIASES[rawLanguage] || rawLanguage;
    if (normalizedLanguage === rawLanguage) return;
    codeEl.classList.remove(languageClass);
    codeEl.classList.add(`language-${normalizedLanguage}`);
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, s => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[s]));
}

function renderFooterHtml(text) {
    const source = typeof text === "string" ? text : "";
    const placeholders = [];
    const escapedText = escapeHtml(source).replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (_match, label, url) => {
            const token = `@@NF_FOOTER_LINK_${placeholders.length}@@`;
            placeholders.push(
                `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`,
            );
            return token;
        },
    );
    const withBareUrls = escapedText.replace(/https?:\/\/[^\s<]+/g, (url) => (
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    ));
    return withBareUrls.replace(/@@NF_FOOTER_LINK_(\d+)@@/g, (_match, indexText) => {
        const index = Number(indexText);
        return Number.isInteger(index) && placeholders[index]
            ? placeholders[index]
            : "";
    });
}

function normalizePath(path) {
    return path.replace(/\\/g, "/");
}

function dirname(path) {
    const normalized = normalizePath(path);
    const idx = normalized.lastIndexOf("/");
    return idx === -1 ? "" : normalized.slice(0, idx);
}

function joinUrl(base, relative) {
    return new URL(relative, window.location.origin + "/" + base).pathname.replace(/^\/+/, "");
}

function resolveAssetPath(mdPath, assetRelativePath) {
    const baseDir = dirname(mdPath);
    const full = new URL(assetRelativePath, window.location.origin + "/" + (baseDir ? baseDir + "/" : ""));
    return full.pathname.replace(/^\/+/, "");
}

function resolveRelativeTarget(mdPath, relativeHref) {
    const baseDir = dirname(mdPath);
    const full = new URL(relativeHref, window.location.origin + "/" + (baseDir ? baseDir + "/" : ""));
    return {
        path: full.pathname.replace(/^\/+/, ""),
        search: full.search || "",
        hash: full.hash || "",
    };
}

function inferFileFormat(path, hint = "") {
    if (hint === "md" || hint === "pdf" || hint === "ipynb") return hint;
    const lower = normalizePath(path).toLowerCase().split(/[?#]/, 1)[0];
    if (lower.endsWith(".pdf")) return "pdf";
    if (lower.endsWith(".ipynb")) return "ipynb";
    return "md";
}

function clearPdfBlobUrl() {
    if (currentPdfBlobUrl) {
        URL.revokeObjectURL(currentPdfBlobUrl);
        currentPdfBlobUrl = null;
    }
}

function getStoredPdfViewMode() {
    const state = getReadingState();
    return state.pdfViewMode === "pdfjs" || state.pdfViewMode === "native"
        ? state.pdfViewMode
        : "";
}

function savePreferredPdfViewMode(mode) {
    const normalizedMode = mode === "pdfjs" ? "pdfjs" : "native";
    const state = getReadingState();
    state.pdfViewMode = normalizedMode;
    saveReadingState(state);
}

function getDefaultPdfViewMode() {
    const storedMode = getStoredPdfViewMode();
    if (storedMode) return storedMode;
    return isMobile() ? "pdfjs" : "native";
}

function buildPdfActionsHtml(mode, sourceUrl) {
    const nativeActive = mode === "native" ? " active" : "";
    const pdfjsActive = mode === "pdfjs" ? " active" : "";
    return `
        <div class="pdf-native-actions">
            <div class="pdf-mode-switch">
                <button class="pdf-mode-btn${nativeActive}" type="button" data-pdf-mode="native">Native Inline</button>
                <button class="pdf-mode-btn${pdfjsActive}" type="button" data-pdf-mode="pdfjs">PDF.js</button>
            </div>
            <a class="pdf-native-open" href="${sourceUrl}" target="_blank" rel="noopener">Open in native viewer</a>
        </div>
    `;
}

function bindPdfModeSwitchHandlers() {
    viewer.querySelectorAll(".pdf-mode-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const mode = btn.getAttribute("data-pdf-mode") || "";
            if (!mode || mode === currentPdfViewMode) return;
            await renderPdfByMode(mode, { persistPreference: true });
        });
    });
}

function ensurePdfJsReady() {
    if (window.pdfjsLib && window.pdfjsLib.getDocument) {
        return Promise.resolve(window.pdfjsLib);
    }
    if (pdfjsReadyPromise) return pdfjsReadyPromise;
    const scriptSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    const workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdfjsReadyPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = scriptSrc;
        script.async = true;
        script.onload = () => {
            if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
                resolve(window.pdfjsLib);
                return;
            }
            reject(new Error("pdf.js loaded but api unavailable"));
        };
        script.onerror = () => reject(new Error("Failed to load pdf.js"));
        document.head.appendChild(script);
    });
    return pdfjsReadyPromise;
}

function updatePdfToolbar() {
    const pageInfo = document.getElementById("pdfPageInfo");
    const zoomInfo = document.getElementById("pdfZoomInfo");
    const zoomOutBtn = document.getElementById("pdfZoomOutBtn");
    const zoomInBtn = document.getElementById("pdfZoomInBtn");
    if (!activePdfDoc) return;
    if (pageInfo) pageInfo.textContent = `${activePdfDoc.numPages} pages`;
    if (zoomInfo) zoomInfo.textContent = `${Math.round(activePdfScale * 100)}%`;
    if (zoomOutBtn) zoomOutBtn.disabled = pdfRenderInFlight;
    if (zoomInBtn) zoomInBtn.disabled = pdfRenderInFlight;
}

async function renderAllPdfPages() {
    if (!activePdfDoc) return;
    const pdfjsLib = await ensurePdfJsReady();
    const container = document.getElementById("pdfCanvasWrap");
    if (!container) return;
    pdfRenderInFlight = true;
    updatePdfToolbar();
    try {
        container.innerHTML = "";
        for (let pageNo = 1; pageNo <= activePdfDoc.numPages; pageNo += 1) {
            const page = await activePdfDoc.getPage(pageNo);
            const unscaled = page.getViewport({ scale: 1 });
            const fitScale = Math.max(0.2, (container.clientWidth || unscaled.width) / unscaled.width);
            const viewport = page.getViewport({ scale: fitScale * activePdfScale });

            const pageWrap = document.createElement("div");
            pageWrap.className = "pdfjs-page";
            const canvas = document.createElement("canvas");
            canvas.className = "pdfjs-canvas";
            const textLayer = document.createElement("div");
            textLayer.className = "pdfjs-text-layer";
            const ratio = window.devicePixelRatio || 1;
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            canvas.width = Math.floor(viewport.width * ratio);
            canvas.height = Math.floor(viewport.height * ratio);
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;
            textLayer.style.width = `${Math.floor(viewport.width)}px`;
            textLayer.style.height = `${Math.floor(viewport.height)}px`;
            pageWrap.appendChild(canvas);
            pageWrap.appendChild(textLayer);
            container.appendChild(pageWrap);

            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            await page.render({ canvasContext: ctx, viewport }).promise;
            const textContent = await page.getTextContent();
            if (pdfjsLib.renderTextLayer) {
                await pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: textLayer,
                    viewport,
                    textDivs: [],
                }).promise;
            }
        }
    } finally {
        pdfRenderInFlight = false;
        updatePdfToolbar();
    }
}

async function initPdfJsViewer(pdfUrl) {
    const pdfjsLib = await ensurePdfJsReady();
    activePdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
    activePdfScale = 1;
    updatePdfToolbar();
    await renderAllPdfPages();
}

async function renderPdfByMode(mode, options = {}) {
    if (!currentPdfSourceUrl) return;
    const { persistPreference = false } = options;
    currentPdfViewMode = mode === "pdfjs" ? "pdfjs" : "native";
    if (persistPreference) {
        savePreferredPdfViewMode(currentPdfViewMode);
    }
    activePdfDoc = null;

    if (currentPdfViewMode === "native") {
        viewer.innerHTML = `
            ${buildPdfActionsHtml("native", currentPdfSourceUrl)}
            <iframe class="pdf-viewer-frame" src="${currentPdfSourceUrl}#page=1&zoom=page-width" title="${escapeHtml(currentPdfTitle)}"></iframe>
        `;
        setMetaHtml(`<div class="article-stats">PDF loaded with browser native viewer</div>`);
        bindPdfModeSwitchHandlers();
        return;
    }

    viewer.innerHTML = `
        ${buildPdfActionsHtml("pdfjs", currentPdfSourceUrl)}
        <div class="pdfjs-shell">
            <div class="pdfjs-toolbar">
                <span id="pdfPageInfo" class="pdfjs-info">- pages</span>
                <button id="pdfZoomOutBtn" class="pdfjs-btn" type="button">-</button>
                <span id="pdfZoomInfo" class="pdfjs-info">100%</span>
                <button id="pdfZoomInBtn" class="pdfjs-btn" type="button">+</button>
            </div>
            <div id="pdfCanvasWrap" class="pdfjs-canvas-wrap"></div>
        </div>
    `;
    bindPdfModeSwitchHandlers();
    try {
        await initPdfJsViewer(currentPdfSourceUrl);
    } catch {
        await renderPdfByMode("native", { persistPreference: false });
        setMetaHtml(`<div class="article-stats">PDF.js failed, switched to native viewer</div>`);
        return;
    }

    const zoomInBtn = document.getElementById("pdfZoomInBtn");
    const zoomOutBtn = document.getElementById("pdfZoomOutBtn");
    if (zoomInBtn) {
        zoomInBtn.addEventListener("click", async () => {
            if (!activePdfDoc || pdfRenderInFlight) return;
            activePdfScale = Math.min(3, activePdfScale * 1.12);
            await renderAllPdfPages();
        });
    }
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener("click", async () => {
            if (!activePdfDoc || pdfRenderInFlight) return;
            activePdfScale = Math.max(0.5, activePdfScale / 1.12);
            await renderAllPdfPages();
        });
    }
    window.requestAnimationFrame(() => {
        renderAllPdfPages().catch(() => {
            // Keep current pages when transient render fails.
        });
    });
    setMetaHtml(`<div class="article-stats">${activePdfDoc.numPages} pages</div>`);
}

function setMetaHtml(html) {
    if (!meta) return;
    meta.innerHTML = html;
}

function setMetaText(text) {
    if (!meta) return;
    meta.textContent = text;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "size unknown";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    const fixed = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(fixed)} ${units[idx]}`;
}

function estimatePdfPageCount(buffer) {
    try {
        const text = new TextDecoder("latin1").decode(buffer);
        const matches = text.match(/\/Type\s*\/Page\b/g);
        if (!matches) return null;
        const count = matches.length;
        return count > 0 ? count : null;
    } catch {
        return null;
    }
}

function renderPdfMeta(pageCount, fileSizeBytes) {
    const sizeText = formatBytes(fileSizeBytes);
    if (Number.isFinite(pageCount) && pageCount > 0) {
        const pageText = `${pageCount.toLocaleString("en-US")} pages`;
        setMetaHtml(`<div class="article-stats">${pageText} · ${sizeText}</div>`);
        return;
    }
    setMetaHtml(`<div class="article-stats">${sizeText}</div>`);
}

function renderTree(nodes, parentEl) {
    nodes.forEach(node => {
        const wrapper = document.createElement("div");
        wrapper.className = "tree-node";

        const label = document.createElement("div");
        label.className = "tree-label";
        label.title = node.name;

        if (node.type === "folder") {
            label.classList.add("folder");
            label.innerHTML = `<span class="folder-icon">📁</span><span>${escapeHtml(node.name)}</span>`;
            const folderIcon = label.querySelector(".folder-icon");

            const children = document.createElement("div");
            children.className = "tree-children";

            label.addEventListener("click", () => {
                children.classList.toggle("expanded");
                const isExpanded = children.classList.contains("expanded");
                label.classList.toggle("expanded", isExpanded);
                if (folderIcon) {
                    folderIcon.textContent = isExpanded ? "📂" : "📁";
                }
            });

            wrapper.appendChild(label);
            wrapper.appendChild(children);
            parentEl.appendChild(wrapper);

            renderTree(node.children || [], children);
        } else if (node.type === "file") {
            const fileFormat = inferFileFormat(node.path, node.format || "");
            const fileIconClass = fileFormat === "pdf"
                ? "file-icon-pdf"
                : (fileFormat === "ipynb" ? "file-icon-ipynb" : "file-icon-md");
            const fileIconText = fileFormat === "pdf"
                ? "P"
                : (fileFormat === "ipynb" ? "N" : "M");
            label.classList.add("tree-file");
            label.innerHTML = `<span class="file-icon ${fileIconClass}" aria-hidden="true">${fileIconText}</span><span class="tree-file-name">${escapeHtml(node.name)}</span>`;

            label.addEventListener("click", () => {
                loadDocument(node.path, node.format || "");
            });

            label.dataset.path = node.path;
            wrapper.appendChild(label);
            parentEl.appendChild(wrapper);
        }
    });
}

function collectSearchableFiles(nodes, out = []) {
    for (const node of nodes) {
        if (node.type === "file") {
            const fmt = inferFileFormat(node.path, node.format || "");
            if (fmt === "md" || fmt === "pdf" || fmt === "ipynb") {
                out.push(node);
            }
            continue;
        }
        if (node.type === "folder" && node.children) {
            collectSearchableFiles(node.children, out);
        }
    }
    return out;
}

function getFileIconMeta(file) {
    const fmt = inferFileFormat(file.path, file.format || "");
    if (fmt === "pdf") return { cls: "file-icon-pdf", text: "P" };
    if (fmt === "ipynb") return { cls: "file-icon-ipynb", text: "N" };
    return { cls: "file-icon-md", text: "M" };
}

function decodePdfLiteralString(raw) {
    if (!raw) return "";
    const withoutParens = raw.slice(1, -1);
    let out = "";
    for (let i = 0; i < withoutParens.length; i += 1) {
        const ch = withoutParens[i];
        if (ch !== "\\") {
            out += ch;
            continue;
        }
        const next = withoutParens[i + 1];
        if (next === undefined) break;
        if (/[0-7]/.test(next)) {
            const oct = withoutParens.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
            if (oct) {
                out += String.fromCharCode(parseInt(oct[0], 8));
                i += oct[0].length;
                continue;
            }
        }
        if (next === "n") out += "\n";
        else if (next === "r") out += "\r";
        else if (next === "t") out += "\t";
        else if (next === "b") out += "\b";
        else if (next === "f") out += "\f";
        else out += next;
        i += 1;
    }
    return out;
}

function normalizePlainText(raw) {
    return String(raw || "").replace(/\s+/g, " ").trim();
}

function extractPdfSearchTextFromBuffer(buffer) {
    let rawText = "";
    try {
        rawText = new TextDecoder("latin1").decode(buffer);
    } catch {
        return "";
    }
    const literals = [];
    const literalPattern = /\((?:\\.|[^\\()])+\)/g;
    let match = literalPattern.exec(rawText);
    while (match) {
        literals.push(decodePdfLiteralString(match[0]));
        match = literalPattern.exec(rawText);
    }
    const fromLiterals = normalizePlainText(literals.join(" "));
    if (fromLiterals) return fromLiterals;

    const fallbackChunks = rawText.match(/[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff ,.;:!?'"()\-_/]{3,}/g) || [];
    return normalizePlainText(fallbackChunks.join(" "));
}

function extractNotebookSearchText(notebook) {
    if (!notebook || typeof notebook !== "object") return "";
    const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
    const chunks = [];
    for (const cell of cells) {
        if (!cell || typeof cell !== "object") continue;
        const source = cellSourceToText(cell.source);
        if (source) chunks.push(source);
        if (cell.cell_type !== "code") continue;
        const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
        for (const out of outputs) {
            const txt = outputToText(out);
            if (txt) chunks.push(txt);
            const md = outputToMarkdown(out);
            if (md) chunks.push(md);
            const latex = outputToLatex(out);
            if (latex) chunks.push(latex);
        }
    }
    return normalizePlainText(chunks.join("\n"));
}

function renderSearchResults(groupedResults, query) {
    if (!searchResults) return;
    searchResults.innerHTML = "";
    const currentMatches = groupedResults.current || [];
    const otherMatches = groupedResults.other || [];
    if (!currentMatches.length && !otherMatches.length) {
        searchResults.innerHTML = `<div class="empty-hint">No matches for "${escapeHtml(query)}".</div>`;
        return;
    }

    const appendSection = (title, items) => {
        if (!items.length) return;
        const section = document.createElement("div");
        section.className = "search-section";
        const heading = document.createElement("div");
        heading.className = "search-section-title";
        heading.textContent = `${title} (${items.length})`;
        section.appendChild(heading);

        items.forEach(item => {
            const { node, snippetHtml, hitIndex } = item;
            const wrapper = document.createElement("div");
            wrapper.className = "search-result-item";
            wrapper.addEventListener("click", () => {
                loadDocument(node.path, node.format || "");
                closeSearchOverlay();
            });
            const icon = getFileIconMeta(node);
            const titleEl = document.createElement("div");
            titleEl.className = "search-result-title";
            titleEl.innerHTML = `<span class="file-icon ${icon.cls}" aria-hidden="true">${icon.text}</span><span>${escapeHtml(node.name)}</span><span class="search-hit-tag">#${hitIndex}</span>`;
            wrapper.appendChild(titleEl);
            if (snippetHtml) {
                const snippet = document.createElement("div");
                snippet.className = "search-result-snippet";
                snippet.innerHTML = snippetHtml;
                wrapper.appendChild(snippet);
            }
            section.appendChild(wrapper);
        });
        searchResults.appendChild(section);
    };

    appendSection("Current file", currentMatches);
    appendSection("Other files", otherMatches);
}

function findMatchIndices(haystackLower, keyword, limit) {
    const out = [];
    if (!keyword) return out;
    let from = 0;
    while (out.length < limit) {
        const idx = haystackLower.indexOf(keyword, from);
        if (idx === -1) break;
        out.push(idx);
        from = idx + Math.max(keyword.length, 1);
    }
    return out;
}

function normalizeSearchText(raw) {
    const plain = stripMarkdown(raw);
    return {
        plain,
        lower: plain.toLowerCase()
    };
}

function makeSnippetHtmlAt(plainText, idx, keyword) {
    if (!plainText || idx < 0) return "";
    const prefixLen = 42;
    const suffixLen = 90;
    const start = Math.max(0, idx - prefixLen);
    const end = Math.min(plainText.length, idx + keyword.length + suffixLen);
    const pre = plainText.slice(start, idx);
    const hit = plainText.slice(idx, idx + keyword.length);
    const post = plainText.slice(idx + keyword.length, end);
    const leftEllipsis = start > 0 ? "..." : "";
    const rightEllipsis = end < plainText.length ? "..." : "";
    return `${leftEllipsis}${escapeHtml(pre)}<mark>${escapeHtml(hit)}</mark>${escapeHtml(post)}${rightEllipsis}`;
}

function buildFileSearchEntries(file, keyword, limit) {
    const content = searchContentCache.get(normalizePath(file.path)) || { plain: "", lower: "" };
    const indices = findMatchIndices(content.lower, keyword, limit);
    if (indices.length > 0) {
        return indices.map((idx, i) => ({
            node: file,
            hitIndex: i + 1,
            snippetHtml: makeSnippetHtmlAt(content.plain, idx, keyword)
        }));
    }
    if (file.name.toLowerCase().includes(keyword)) {
        const fallback = content.plain.slice(0, 120).trim();
        return [{
            node: file,
            hitIndex: 1,
            snippetHtml: fallback ? escapeHtml(fallback) : "(filename match)"
        }];
    }
    return [];
}

async function ensureSearchIndex() {
    if (searchIndexBuildPromise) return searchIndexBuildPromise;
    searchIndexBuildPromise = (async () => {
        const tasks = searchableFiles.map(async file => {
            const key = normalizePath(file.path);
            if (searchContentCache.has(key)) return;
            const fmt = inferFileFormat(file.path, file.format || "");
            try {
                const response = await fetchWithBackendState(file.path);
                if (!response.ok) {
                    searchContentCache.set(key, { plain: "", lower: "" });
                    return;
                }
                if (fmt === "ipynb") {
                    const notebook = await response.json();
                    searchContentCache.set(key, normalizeSearchText(extractNotebookSearchText(notebook)));
                    return;
                }
                if (fmt === "pdf") {
                    const buffer = await response.arrayBuffer();
                    searchContentCache.set(key, normalizeSearchText(extractPdfSearchTextFromBuffer(buffer)));
                    return;
                }
                const text = await response.text();
                searchContentCache.set(key, normalizeSearchText(text));
            } catch {
                searchContentCache.set(key, { plain: "", lower: "" });
            }
        });
        await Promise.all(tasks);
    })();
    return searchIndexBuildPromise;
}

async function performSearch(query) {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
        if (searchResults) {
            searchResults.innerHTML = `<div class="empty-hint">Type to search...</div>`;
        }
        return;
    }

    await ensureSearchIndex();
    const normalizedCurrent = currentFilePath ? normalizePath(currentFilePath) : "";
    const currentFile = searchableFiles.find(
        file => normalizePath(file.path) === normalizedCurrent
    );
    const currentMatches = currentFile
        ? buildFileSearchEntries(currentFile, keyword, CURRENT_FILE_HIT_LIMIT)
        : [];
    const otherMatches = searchableFiles.flatMap(file => {
        if (currentFile && normalizePath(file.path) === normalizePath(currentFile.path)) {
            return [];
        }
        return buildFileSearchEntries(file, keyword, OTHER_FILE_HIT_LIMIT);
    });
    renderSearchResults({ current: currentMatches, other: otherMatches }, query);
}

function expandParentsOf(path) {
    const target = treeContainer.querySelector(`.tree-label[data-path="${CSS.escape(path)}"]`);
    if (!target) return;

    let el = target.parentElement;
    while (el && el !== treeContainer) {
        if (el.classList.contains("tree-children")) {
            el.classList.add("expanded");
            const label = el.previousElementSibling;
            if (label && label.classList.contains("folder")) {
                label.classList.add("expanded");
            }
        }
        el = el.parentElement;
    }
}

function collapseAllTreeFolders() {
    if (!treeContainer) return;
    treeContainer.querySelectorAll(".tree-children.expanded").forEach((el) => {
        el.classList.remove("expanded");
    });
    treeContainer.querySelectorAll(".tree-label.folder.expanded").forEach((el) => {
        el.classList.remove("expanded");
    });
}

function getReadingState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { lastFile: "", scrollByFile: {}, pdfViewMode: "" };
        const parsed = JSON.parse(raw);
        return {
            lastFile: parsed.lastFile || "",
            scrollByFile: parsed.scrollByFile || {},
            pdfViewMode: parsed.pdfViewMode === "pdfjs" || parsed.pdfViewMode === "native"
                ? parsed.pdfViewMode
                : ""
        };
    } catch {
        return { lastFile: "", scrollByFile: {}, pdfViewMode: "" };
    }
}

function saveReadingState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persistScrollPosition() {
    if (!currentFilePath) return;
    const state = getReadingState();
    state.lastFile = currentFilePath;
    state.scrollByFile[currentFilePath] = contentEl.scrollTop;
    saveReadingState(state);
}

function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark", isDark);
    themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
    if (hljsLightTheme) hljsLightTheme.disabled = isDark;
    if (hljsDarkTheme) hljsDarkTheme.disabled = !isDark;
}

function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    applyTheme(stored === "dark" ? "dark" : "light");
}

function toggleTheme() {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getSidebarWidthVar(propertyName, min, max) {
    const width = parseFloat(getComputedStyle(appEl).getPropertyValue(propertyName));
    return Number.isFinite(width) ? clamp(width, min, max) : min;
}

function isDockedDesktop() {
    return !isMobile() && appEl.classList.contains("desktop-docked");
}

function isSidebarOverlayMode() {
    return isMobile() || appEl.classList.contains("desktop-overlay");
}

function canUseDockedDesktop() {
    if (isMobile()) return false;
    const slotWidth = computeDesktopSideSlot();
    return window.innerWidth >= DESKTOP_DOCKED_CONTENT_MIN + (slotWidth * 2);
}

function computeDesktopSideSlot() {
    const leftWidth = hideTreeUi || appEl.classList.contains("left-collapsed")
        ? 0
        : getSidebarWidthVar("--left-sidebar-width", MIN_LEFT_SIDEBAR, MAX_LEFT_SIDEBAR);
    const rightWidth = hideTocUi || appEl.classList.contains("right-collapsed")
        ? 0
        : getSidebarWidthVar("--right-sidebar-width", MIN_RIGHT_SIDEBAR, MAX_RIGHT_SIDEBAR);
    return Math.max(leftWidth, rightWidth);
}

function getSidebarBounds(side) {
    const isLeft = side === "left";
    const hardMin = isLeft ? MIN_LEFT_SIDEBAR : MIN_RIGHT_SIDEBAR;
    const hardMax = isLeft ? MAX_LEFT_SIDEBAR : MAX_RIGHT_SIDEBAR;
    if (!isDockedDesktop()) {
        return { min: hardMin, max: hardMax };
    }
    const slotWidth = Math.max(0, computeDesktopSideSlot());
    const max = Math.min(hardMax, slotWidth);
    const min = Math.min(hardMin, max);
    return { min, max };
}

function setSidebarWidthVars(leftWidth, rightWidth) {
    if (Number.isFinite(leftWidth)) {
        const bounds = getSidebarBounds("left");
        appEl.style.setProperty("--left-sidebar-width", `${clamp(leftWidth, bounds.min, bounds.max)}px`);
    }
    if (Number.isFinite(rightWidth)) {
        const bounds = getSidebarBounds("right");
        appEl.style.setProperty("--right-sidebar-width", `${clamp(rightWidth, bounds.min, bounds.max)}px`);
    }
}

function getSidebarWidths() {
    const leftBounds = getSidebarBounds("left");
    const rightBounds = getSidebarBounds("right");
    const leftWidth = getSidebarWidthVar("--left-sidebar-width", leftBounds.min, leftBounds.max);
    const rightWidth = getSidebarWidthVar("--right-sidebar-width", rightBounds.min, rightBounds.max);
    return { leftWidth, rightWidth };
}

function getDisplayTitle(path, container) {
    const firstH1 = container.querySelector("h1");
    const headingTitle = firstH1 ? firstH1.textContent.trim() : "";
    if (headingTitle) return headingTitle;
    const fileName = normalizePath(path).split("/").pop() || "Document";
    return fileName.replace(/\.md$/i, "");
}

function updatePageTitle(path, container) {
    const title = getDisplayTitle(path, container);
    document.title = `${title} - ${BASE_TITLE}`;
    mobileTitle.textContent = title || "Document";
}

function resetPageTitle() {
    document.title = BASE_TITLE;
    mobileTitle.textContent = "Document";
}

function stripMarkdown(mdText) {
    return mdText
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/[#>*_~\-\[\]\(\)!`]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function calcReadingStats(mdText) {
    const plain = stripMarkdown(mdText);
    const cjkCount = (plain.match(/[\u3400-\u9fff]/g) || []).length;
    const wordCount = (plain.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
    const minutes = Math.max(1, Math.ceil((cjkCount / 300) + (wordCount / 200)));
    return { cjkCount, wordCount, minutes };
}

function formatLengthLabel(stats) {
    const cjk = stats.cjkCount.toLocaleString("zh-CN");
    const words = stats.wordCount.toLocaleString("zh-CN");
    if (stats.cjkCount > 0 && stats.wordCount > 0) {
        return `${cjk} chars / ${words} words`;
    }
    if (stats.cjkCount > 0) return `${cjk} chars`;
    return `${words} words`;
}

function renderArticleMeta(title, mdText) {
    const stats = calcReadingStats(mdText);
    const lengthLabel = formatLengthLabel(stats);
    setMetaHtml(`<div class="article-stats">${lengthLabel} · ${stats.minutes} min read</div>`);
}

function saveDesktopLayout() {
    const { leftWidth, rightWidth } = getSidebarWidths();
    const layout = {
        leftCollapsed: appEl.classList.contains("left-collapsed"),
        rightCollapsed: appEl.classList.contains("right-collapsed"),
        leftWidth: Number.isFinite(leftWidth) ? Math.round(leftWidth) : undefined,
        rightWidth: Number.isFinite(rightWidth) ? Math.round(rightWidth) : undefined
    };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

function applyDesktopLayoutFromStorage() {
    try {
        const raw = localStorage.getItem(LAYOUT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        appEl.classList.toggle("left-collapsed", !!parsed.leftCollapsed);
        appEl.classList.toggle("right-collapsed", !!parsed.rightCollapsed);
        setSidebarWidthVars(Number(parsed.leftWidth), Number(parsed.rightWidth));
    } catch {
        appEl.classList.remove("left-collapsed");
        appEl.classList.remove("right-collapsed");
    }
}

function toggleLeftSidebarDesktop() {
    if (hideTreeUi) return;
    if (isMobile()) return;
    if (isDockedDesktop()) {
        appEl.classList.toggle("left-collapsed");
        saveDesktopLayout();
        syncTopActionsOffset();
        return;
    }
    if (sidebar.classList.contains("open")) {
        closePanels();
    } else {
        openTreePanel();
    }
}

function toggleRightSidebarDesktop() {
    if (hideTocUi) return;
    if (isMobile()) return;
    if (isDockedDesktop()) {
        appEl.classList.toggle("right-collapsed");
        saveDesktopLayout();
        syncTopActionsOffset();
        return;
    }
    if (tocSidebar.classList.contains("open")) {
        closePanels();
    } else {
        openTocPanel();
    }
}

function bindSidebarResizer(resizerEl, side) {
    if (!resizerEl) return;
    let active = false;
    let pointerId = null;
    let startX = 0;
    let startWidth = 0;
    let startedCollapsed = false;

    const isLeft = side === "left";
    const collapsedClass = isLeft ? "left-collapsed" : "right-collapsed";

    const onMove = (event) => {
        if (!active || !isDockedDesktop()) return;
        const { min: minWidth, max: maxWidth } = getSidebarBounds(side);
        const dx = event.clientX - startX;
        const rawWidth = isLeft ? (startWidth + dx) : (startWidth - dx);

        if (startedCollapsed && rawWidth <= 0) {
            appEl.classList.add(collapsedClass);
        } else if (!startedCollapsed && rawWidth < minWidth) {
            appEl.classList.add(collapsedClass);
        } else {
            const nextWidth = clamp(rawWidth, minWidth, maxWidth);
            appEl.classList.remove(collapsedClass);
            if (isLeft) {
                setSidebarWidthVars(nextWidth, NaN);
            } else {
                setSidebarWidthVars(NaN, nextWidth);
            }
        }
        syncTopActionsOffset();
    };

    const onUp = () => {
        if (!active) return;
        active = false;
        pointerId = null;
        resizerEl.classList.remove("active");
        document.body.style.userSelect = "";
        saveDesktopLayout();
    };

    resizerEl.addEventListener("pointerdown", (event) => {
        if (!isDockedDesktop()) return;
        active = true;
        pointerId = event.pointerId;
        startedCollapsed = appEl.classList.contains(collapsedClass);
        startX = event.clientX;
        startWidth = startedCollapsed
            ? 0
            : (isLeft
                ? parseFloat(getComputedStyle(sidebar).width)
                : parseFloat(getComputedStyle(tocSidebar).width));
        resizerEl.setPointerCapture(pointerId);
        resizerEl.classList.add("active");
        document.body.style.userSelect = "none";
        event.preventDefault();
    });

    window.addEventListener("pointermove", (event) => {
        if (pointerId !== null && event.pointerId !== pointerId) return;
        onMove(event);
    });
    window.addEventListener("pointerup", (event) => {
        if (pointerId !== null && event.pointerId !== pointerId) return;
        onUp();
    });
    window.addEventListener("pointercancel", (event) => {
        if (pointerId !== null && event.pointerId !== pointerId) return;
        onUp();
    });
}

function syncDesktopLayoutMode() {
    const docked = canUseDockedDesktop();
    appEl.classList.toggle("desktop-docked", docked);
    appEl.classList.toggle("desktop-overlay", !docked && !isMobile());
    appEl.style.setProperty("--desktop-side-slot", docked ? `${computeDesktopSideSlot()}px` : "0px");
    const { leftWidth, rightWidth } = getSidebarWidths();
    setSidebarWidthVars(leftWidth, rightWidth);
    if (!isSidebarOverlayMode()) {
        sidebar.classList.remove("open");
        tocSidebar.classList.remove("open");
        backdrop.classList.remove("show");
        document.body.style.overflow = "";
    }
}

function syncTopActionsOffset() {
    syncDesktopLayoutMode();
}

function setActiveFile(path) {
    if (hideTreeUi) return;
    document.querySelectorAll(".tree-label.active").forEach(el => el.classList.remove("active"));
    const target = treeContainer.querySelector(`.tree-label[data-path="${CSS.escape(path)}"]`);
    if (target) {
        target.classList.add("active");
        expandParentsOf(path);
    }
}

function isMobile() {
    return mobileMedia.matches;
}

function isAppleMobileBrowser() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const maxTouch = Number(navigator.maxTouchPoints || 0);
    const iOS = /iPad|iPhone|iPod/i.test(ua);
    const iPadOS = platform === "MacIntel" && maxTouch > 1;
    return iOS || iPadOS;
}

function closePanels() {
    if (!hideTreeUi) sidebar.classList.remove("open");
    if (!hideTocUi) tocSidebar.classList.remove("open");
    backdrop.classList.remove("show");
    document.body.style.overflow = "";
    syncTopActionsOffset();
}

function openTreePanel() {
    if (hideTreeUi) return;
    if (!isSidebarOverlayMode()) return;
    sidebar.classList.add("open");
    tocSidebar.classList.remove("open");
    backdrop.classList.add("show");
    document.body.style.overflow = "hidden";
    syncTopActionsOffset();
}

function openTocPanel() {
    if (hideTocUi) return;
    if (!isSidebarOverlayMode()) return;
    tocSidebar.classList.add("open");
    sidebar.classList.remove("open");
    backdrop.classList.add("show");
    document.body.style.overflow = "hidden";
    syncTopActionsOffset();
}

function rewriteRelativeLinks(container, mdPath) {
    container.querySelectorAll("img").forEach(img => {
        const src = img.getAttribute("src");
        if (!src || /^(https?:|data:|#|\/)/i.test(src)) return;
        img.src = resolveAssetPath(mdPath, src);
    });

    container.querySelectorAll("a").forEach(a => {
        const href = a.getAttribute("href");
        if (!href || /^(https?:|mailto:|#|\/)/i.test(href)) return;
        const target = resolveRelativeTarget(mdPath, href);
        const fileFormat = inferFileFormat(target.path);
        const isDocLink = /(?:\.md|\.pdf|\.ipynb)$/i.test(target.path);

        if (!isDocLink) {
            a.href = `${target.path}${target.search}${target.hash}`;
            return;
        }

        a.href = "#" + target.path;
        a.addEventListener("click", function (e) {
            e.preventDefault();
            loadDocument(target.path, fileFormat);
        });
    });
}

function enhanceMarkdownContent(container) {
    container.querySelectorAll("pre code").forEach(codeEl => {
        if (codeEl.dataset.hljsDone === "1") return;
        normalizeCodeLanguageClass(codeEl);
        if (window.hljs && typeof window.hljs.highlightElement === "function") {
            window.hljs.highlightElement(codeEl);
            codeEl.dataset.hljsDone = "1";
        }
    });

    if (window.hljs && typeof window.hljs.highlightAll === "function") {
        window.hljs.highlightAll();
    }

    container.querySelectorAll("table").forEach(table => {
        if (table.parentElement && table.parentElement.classList.contains("table-scroll")) return;
        const wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    });

    container.querySelectorAll("pre").forEach(pre => {
        if (pre.querySelector(".copy-btn")) return;
        const code = pre.querySelector("code");
        if (!code) return;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "copy-btn";
        btn.textContent = "⧉";
        btn.addEventListener("click", async () => {
            const original = btn.textContent;
            try {
                await navigator.clipboard.writeText(code.innerText);
                btn.textContent = "✓";
            } catch {
                btn.textContent = "!";
            }
            setTimeout(() => {
                btn.textContent = original;
            }, 1200);
        });
        pre.appendChild(btn);
    });
}

function slugify(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\u4e00-\u9fa5\- ]+/g, "")
        .replace(/\s+/g, "-");
}

function buildTOC(container) {
    if (hideTocUi) {
        tocContainer.innerHTML = `<div class="empty-hint">TOC hidden</div>`;
        return;
    }
    const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");

    if (!headings.length) {
        tocContainer.innerHTML = `<div class="empty-hint">No headings</div>`;
        return;
    }

    const usedIds = new Map();
    const items = [];

    headings.forEach((heading, index) => {
        const level = Number(heading.tagName.charAt(1));
        const text = heading.textContent.trim();

        let id = heading.id;
        if (!id) {
            let base = slugify(text) || `heading-${index + 1}`;
            let count = usedIds.get(base) || 0;
            count += 1;
            usedIds.set(base, count);
            id = count === 1 ? base : `${base}-${count}`;
            heading.id = id;
        }

        items.push({ id, text, level });
    });

    tocContainer.innerHTML = items.map(item => `
    <a class="toc-item toc-level-${item.level}" href="#${item.id}" data-toc-id="${item.id}">
      ${escapeHtml(item.text)}
    </a>
  `).join("");

    tocContainer.querySelectorAll(".toc-item").forEach(link => {
        link.addEventListener("click", function (e) {
            e.preventDefault();
            const id = this.dataset.tocId;
            const target = document.getElementById(id);
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                setActiveTOC(id);
            }
        });
    });

    observeHeadings(headings);
}

function setActiveTOC(id) {
    if (hideTocUi) return;
    tocContainer.querySelectorAll(".toc-item.active").forEach(el => {
        el.classList.remove("active");
    });

    const target = tocContainer.querySelector(`.toc-item[data-toc-id="${CSS.escape(id)}"]`);
    if (target) {
        target.classList.add("active");
    }
}


let headingObserver = null;

function observeHeadings(headings) {
    if (hideTocUi) return;
    if (headingObserver) {
        headingObserver.disconnect();
    }

    const visibleHeadings = new Map();

    headingObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                visibleHeadings.set(entry.target.id, entry.target);
            } else {
                visibleHeadings.delete(entry.target.id);
            }
        });

        const all = Array.from(visibleHeadings.values());
        if (all.length > 0) {
            all.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            setActiveTOC(all[0].id);
        }
    }, {
        root: document.querySelector(".content"),
        rootMargin: "0px 0px -70% 0px",
        threshold: 0
    });

    headings.forEach(h => headingObserver.observe(h));

    if (headings.length > 0) {
        setActiveTOC(headings[0].id);
    }
}

function enableMathHorizontalScroll(container) {
    container.querySelectorAll('.mjx-container[jax="CHTML"][display="true"]').forEach((el) => {
        const parent = el.parentElement;
        if (parent && parent.classList.contains("math-scroll")) return;
        const wrap = document.createElement("div");
        wrap.className = "math-scroll";
        el.parentNode.insertBefore(wrap, el);
        wrap.appendChild(el);
    });
}

function cellSourceToText(source) {
    if (Array.isArray(source)) {
        // Jupyter "source" lines usually keep trailing newlines.
        // If they already contain newline chars, join as-is to avoid double blank lines.
        const hasEmbeddedNewline = source.some(
            (part) => typeof part === "string" && /[\r\n]/.test(part)
        );
        return hasEmbeddedNewline ? source.join("") : source.join("\n");
    }
    return typeof source === "string" ? source : "";
}

function outputToText(output) {
    if (!output || typeof output !== "object") return "";
    if (output.output_type === "stream") {
        return cellSourceToText(output.text);
    }
    if (output.output_type === "error") {
        const traceback = Array.isArray(output.traceback) ? output.traceback.join("\n") : "";
        return traceback || `${output.ename || "Error"}: ${output.evalue || ""}`;
    }
    const data = output.data || {};
    if (typeof data["text/plain"] === "string" || Array.isArray(data["text/plain"])) {
        return cellSourceToText(data["text/plain"]);
    }
    return "";
}

function outputToLatex(output) {
    if (!output || typeof output !== "object") return "";
    const data = output.data || {};
    if (typeof data["text/latex"] === "string" || Array.isArray(data["text/latex"])) {
        return cellSourceToText(data["text/latex"]).trim();
    }
    return "";
}

function outputToMarkdown(output) {
    if (!output || typeof output !== "object") return "";
    const data = output.data || {};
    if (typeof data["text/markdown"] === "string" || Array.isArray(data["text/markdown"])) {
        return cellSourceToText(data["text/markdown"]).trim();
    }
    return "";
}

function outputToImageData(output) {
    if (!output || typeof output !== "object") return null;
    const data = output.data || {};
    const imageMimePriority = [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/svg+xml",
    ];
    for (const mime of imageMimePriority) {
        const raw = data[mime];
        if (typeof raw !== "string" && !Array.isArray(raw)) continue;
        const content = cellSourceToText(raw).trim();
        if (!content) continue;
        return { mime, content };
    }
    return null;
}

function imagePayloadToDataUrl(imagePayload) {
    if (!imagePayload) return "";
    const { mime, content } = imagePayload;
    if (!mime || !content) return "";
    if (content.startsWith("data:")) return content;

    if (mime === "image/svg+xml") {
        const compact = content.trim();
        if (/^<\?xml\b|^<svg\b/i.test(compact)) {
            return `data:${mime};charset=utf-8,${encodeURIComponent(compact)}`;
        }
        const b64 = compact.replace(/\s+/g, "");
        return `data:${mime};base64,${b64}`;
    }

    const b64 = content.replace(/\s+/g, "");
    return `data:${mime};base64,${b64}`;
}

async function loadNotebookDocument(path) {
    try {
        contentEl.classList.remove("pdf-content-mode");
        clearPdfBlobUrl();
        articleWrapper.classList.remove("pdf-mode");
        persistScrollPosition();
        currentFilePath = normalizePath(path);
        setActiveFile(currentFilePath);
        location.hash = currentFilePath;
        document.title = `Loading - ${BASE_TITLE}`;

        setMetaHtml(`<div class="article-stats">Loading notebook...</div>`);
        viewer.innerHTML = "Loading notebook...";

        const response = await fetchWithBackendState(currentFilePath);
        if (!response.ok) {
            throw new Error(`Failed to load: ${currentFilePath}`);
        }
        const notebook = await response.json();
        const cells = Array.isArray(notebook.cells) ? notebook.cells : [];

        const root = document.createElement("div");
        root.className = "notebook-root";
        if (!cells.length) {
            root.innerHTML = `<div class="empty-hint">Notebook has no cells.</div>`;
        }

        cells.forEach((cell, idx) => {
            const cellType = cell?.cell_type || "";
            if (cellType === "markdown") {
                const section = document.createElement("section");
                section.className = "notebook-cell notebook-markdown";
                section.innerHTML = parseMarkdownWithDisplayMath(cellSourceToText(cell.source));
                root.appendChild(section);
                return;
            }
            if (cellType === "code") {
                const section = document.createElement("section");
                section.className = "notebook-cell notebook-code";
                const sourceText = cellSourceToText(cell.source);
                section.innerHTML = `<div class="nb-cell-label">In [${cell.execution_count ?? " "}]:</div><pre><code>${escapeHtml(sourceText)}</code></pre>`;
                const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
                let outputLabelShown = false;
                outputs.forEach((out) => {
                    const ensureOutputLabel = () => {
                        if (outputLabelShown) return;
                        const label = document.createElement("div");
                        label.className = "nb-cell-label";
                        label.textContent = "Out:";
                        section.appendChild(label);
                        outputLabelShown = true;
                    };

                    const latex = outputToLatex(out);
                    if (latex) {
                        ensureOutputLabel();
                        const outEl = document.createElement("div");
                        outEl.className = "nb-output nb-output-math";
                        const wrapped = /(^\$\$[\s\S]*\$\$$)|(^\\\[[\s\S]*\\\]$)/.test(latex)
                            ? latex
                            : `$$${latex}$$`;
                        outEl.textContent = wrapped;
                        section.appendChild(outEl);
                        return;
                    }

                    const imageData = outputToImageData(out);
                    if (imageData) {
                        const imageSrc = imagePayloadToDataUrl(imageData);
                        if (imageSrc) {
                            ensureOutputLabel();
                            const outEl = document.createElement("div");
                            outEl.className = "nb-output nb-output-image";
                            outEl.innerHTML = `<img class="nb-output-image-el" src="${escapeHtml(imageSrc)}" alt="Notebook output image" loading="lazy">`;
                            section.appendChild(outEl);
                            return;
                        }
                    }

                    const md = outputToMarkdown(out);
                    if (md) {
                        ensureOutputLabel();
                        const outEl = document.createElement("div");
                        outEl.className = "nb-output nb-output-markdown";
                        outEl.innerHTML = parseMarkdownWithDisplayMath(md);
                        section.appendChild(outEl);
                        return;
                    }

                    const txt = outputToText(out);
                    if (txt.trim()) {
                        ensureOutputLabel();
                        const outEl = document.createElement("pre");
                        outEl.className = "nb-output";
                        outEl.innerHTML = `<code>${escapeHtml(txt)}</code>`;
                        section.appendChild(outEl);
                    }
                });
                root.appendChild(section);
                return;
            }

            const unsupported = document.createElement("section");
            unsupported.className = "notebook-cell";
            unsupported.innerHTML = `<div class="empty-hint">Unsupported cell type: ${escapeHtml(String(cellType || "unknown"))}</div>`;
            root.appendChild(unsupported);
        });

        viewer.innerHTML = "";
        viewer.appendChild(root);
        rewriteRelativeLinks(viewer, currentFilePath);
        await ensureHljsReady();
        enhanceMarkdownContent(viewer);

        if (window.MathJax && window.MathJax.typesetPromise) {
            await MathJax.typesetPromise([viewer]);
        }
        enableMathHorizontalScroll(viewer);

        buildTOC(viewer);
        updatePageTitle(currentFilePath, viewer);
        setMetaHtml(`<div class="article-stats">${cells.length} cells</div>`);
        const state = getReadingState();
        const savedScroll = Number(state.scrollByFile[currentFilePath] || 0);
        contentEl.scrollTop = Number.isFinite(savedScroll) ? savedScroll : 0;
        closePanels();
        syncTopActionsOffset();
    } catch (err) {
        viewer.innerHTML = `<div class="error">Error: ${escapeHtml(err.message)}</div>`;
        tocContainer.innerHTML = `<div class="empty-hint">TOC unavailable</div>`;
        setMetaHtml(`<div class="article-stats">Load failed</div>`);
        document.title = `Error - ${BASE_TITLE}`;
    }
}

async function loadMarkdown(path) {
    try {
        contentEl.classList.remove("pdf-content-mode");
        clearPdfBlobUrl();
        articleWrapper.classList.remove("pdf-mode");
        persistScrollPosition();
        currentFilePath = normalizePath(path);
        setActiveFile(currentFilePath);
        location.hash = currentFilePath;
        document.title = `Loading - ${BASE_TITLE}`;

        setMetaHtml(`<div class="article-stats">Loading...</div>`);
        viewer.innerHTML = "Loading...";

        const response = await fetchWithBackendState(currentFilePath);
        if (!response.ok) {
            throw new Error(`Failed to load: ${currentFilePath}`);
        }

        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder("utf-8");
        const text = decoder.decode(buffer);

        const html = parseMarkdownWithDisplayMath(text);
        viewer.innerHTML = html;

        rewriteRelativeLinks(viewer, currentFilePath);
        await ensureHljsReady();
        enhanceMarkdownContent(viewer);

        if (window.MathJax && window.MathJax.typesetPromise) {
            await MathJax.typesetPromise([viewer]);
        }
        enableMathHorizontalScroll(viewer);

        buildTOC(viewer);
        updatePageTitle(currentFilePath, viewer);
        renderArticleMeta(getDisplayTitle(currentFilePath, viewer), text);
        const state = getReadingState();
        const savedScroll = Number(state.scrollByFile[currentFilePath] || 0);
        contentEl.scrollTop = Number.isFinite(savedScroll) ? savedScroll : 0;
        closePanels();
        syncTopActionsOffset();
    } catch (err) {
        viewer.innerHTML = `<div class="error">Error: ${escapeHtml(err.message)}

Possible causes:
1. Invalid file path
2. Not served via http://
3. Broken relative links in markdown</div>`;

        tocContainer.innerHTML = `<div class="empty-hint">TOC unavailable</div>`;
        setMetaHtml(`<div class="article-stats">Load failed</div>`);
        document.title = `Error - ${BASE_TITLE}`;
    }
}

async function loadPdfDocument(path) {
    try {
        clearPdfBlobUrl();
        activePdfDoc = null;
        persistScrollPosition();
        contentEl.classList.add("pdf-content-mode");
        articleWrapper.classList.add("pdf-mode");
        currentFilePath = normalizePath(path);
        setActiveFile(currentFilePath);
        location.hash = currentFilePath;
        document.title = `Loading - ${BASE_TITLE}`;

        setMetaHtml(`<div class="article-stats">Loading PDF...</div>`);
        viewer.innerHTML = "Loading PDF...";
        const title = getDisplayTitle(currentFilePath, document.body);
        const healthProbe = await fetchWithBackendState(currentFilePath, { method: "HEAD" });
        if (!healthProbe.ok) {
            throw new Error(`Failed to load: ${currentFilePath}`);
        }
        currentPdfSourceUrl = encodeURI(currentFilePath);
        currentPdfTitle = title;
        await renderPdfByMode(getDefaultPdfViewMode(), { persistPreference: false });

        tocContainer.innerHTML = `<div class="empty-hint">TOC unavailable for PDF</div>`;
        updatePageTitle(currentFilePath, viewer);
        contentEl.scrollTop = 0;
        const state = getReadingState();
        state.lastFile = currentFilePath;
        state.scrollByFile[currentFilePath] = 0;
        saveReadingState(state);
        closePanels();
        syncTopActionsOffset();
    } catch (err) {
        contentEl.classList.remove("pdf-content-mode");
        articleWrapper.classList.remove("pdf-mode");
        viewer.innerHTML = `<div class="error">Error: ${escapeHtml(err.message)}</div>`;
        tocContainer.innerHTML = `<div class="empty-hint">TOC unavailable</div>`;
        setMetaHtml(`<div class="article-stats">Load failed</div>`);
        document.title = `Error - ${BASE_TITLE}`;
    }
}

async function loadMarkdownDocument(path) {
    await loadMarkdown(path);
}

async function loadDocument(path, preferredFormat = "") {
    const fileFormat = inferFileFormat(path, preferredFormat);
    if (fileFormat === "pdf") {
        await loadPdfDocument(path);
        return;
    }
    if (fileFormat === "ipynb") {
        await loadNotebookDocument(path);
        return;
    }
    await loadMarkdownDocument(path);
}

async function loadTree() {
    try {
        const response = await fetchWithBackendState("tree.json");
        if (!response.ok) {
            throw new Error("Failed to load tree.json");
        }
        const tree = await response.json();
        currentTreeData = tree;
        searchableFiles = collectSearchableFiles(tree);
        searchContentCache.clear();
        searchIndexBuildPromise = null;

        treeContainer.innerHTML = "";
        renderTree(tree, treeContainer);

        const hashPath = decodeURIComponent(location.hash.replace(/^#/, "").trim());
        if (hashPath) {
            loadDocument(hashPath);
            return;
        }

        const topLevelDefault = pickTopLevelDefaultFile(tree);
        if (topLevelDefault) {
            loadDocument(topLevelDefault.path, topLevelDefault.format || "");
            return;
        }

        const firstFile = findFirstFile(tree);
        if (firstFile) {
            loadDocument(firstFile.path, firstFile.format || "");
        } else {
            setMetaText("No supported files found");
            viewer.textContent = "No supported files (.md/.pdf/.ipynb) in this folder.";
            resetPageTitle();
        }
    } catch (err) {
        treeContainer.innerHTML = `<div class="error">Tree load failed: ${escapeHtml(err.message)}</div>`;
        document.title = `Error - ${BASE_TITLE}`;
    }
}

function findFirstFile(nodes) {
    for (const node of nodes) {
        if (node.type === "file") return node;
        if (node.type === "folder" && node.children) {
            const found = findFirstFile(node.children);
            if (found) return found;
        }
    }
    return null;
}

function pickTopLevelDefaultFile(nodes) {
    const topFiles = nodes.filter(node => node.type === "file");
    if (topFiles.length === 1) return topFiles[0];
    if (topFiles.length === 0) return null;

    const preferredNames = [
        "readme.md",
        "index.md",
        "home.md",
        "start.md",
        "getting-started.md",
        "intro.md"
    ];
    const byName = new Map(topFiles.map(file => [file.name.toLowerCase(), file]));
    for (const name of preferredNames) {
        if (byName.has(name)) return byName.get(name);
    }
    return null;
}

function applyUiConfig() {
    if (hideTreeUi) {
        appEl.classList.add("hide-tree", "left-collapsed");
    }
    if (hideTocUi) {
        appEl.classList.add("hide-toc", "right-collapsed");
    }
    if (fixedFooter) {
        if (footerText) {
            fixedFooter.innerHTML = renderFooterHtml(footerText);
            fixedFooter.hidden = false;
        } else {
            fixedFooter.hidden = true;
        }
    }
    if (openSearchBtn) {
        openSearchBtn.hidden = !(enableSearchUi && !hideTreeUi);
    }
    if (downloadBtn) {
        downloadBtn.hidden = !enableDownloadUi;
    }
    if (themeToggleBtn) {
        themeToggleBtn.hidden = !enableThemeUi;
    }
}

async function downloadCurrentFile() {
    if (!currentFilePath) return;
    try {
        const response = await fetchWithBackendState(currentFilePath);
        if (!response.ok) throw new Error("download failed");
        const blob = await response.blob();
        const filename = normalizePath(currentFilePath).split("/").pop() || "document";
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
    } catch {
        // Ignore and keep UI stable.
    }
}

function openSearchOverlay() {
    if (!(enableSearchUi && !hideTreeUi)) return;
    if (!searchOverlay) return;
    searchOverlay.hidden = false;
    if (searchResults && !searchInput?.value.trim()) {
        searchResults.innerHTML = `<div class="empty-hint">Type to search...</div>`;
    }
    if (searchInput) {
        searchInput.focus();
        searchInput.select();
    }
}

function closeSearchOverlay() {
    if (!searchOverlay) return;
    searchOverlay.hidden = true;
    if (searchInput) searchInput.blur();
}

window.addEventListener("hashchange", () => {
    const hashPath = decodeURIComponent(location.hash.replace(/^#/, "").trim());
    if (hashPath && hashPath !== currentFilePath) {
        loadDocument(hashPath);
    }
});

if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
        if (!(enableSearchUi && !hideTreeUi)) return;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            performSearch(searchInput.value);
        }, 120);
    });
}

if (openSearchBtn) {
    openSearchBtn.addEventListener("click", openSearchOverlay);
}

if (downloadBtn) {
    downloadBtn.addEventListener("click", downloadCurrentFile);
}

if (backendRetryBtn) {
    backendRetryBtn.addEventListener("click", () => {
        probeBackendHealth(true);
    });
}

if (searchOverlay) {
    searchOverlay.addEventListener("click", (event) => {
        if (event.target === searchOverlay) closeSearchOverlay();
    });
}

document.addEventListener("keydown", (event) => {
    if ((event.key === "Escape" || event.key === "Esc") && searchOverlay && !searchOverlay.hidden) {
        closeSearchOverlay();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearchOverlay();
    }
}, true);

openTreeBtn.addEventListener("click", openTreePanel);
openTocBtn.addEventListener("click", openTocPanel);
openTreeDesktopBtn.addEventListener("click", toggleLeftSidebarDesktop);
openTocDesktopBtn.addEventListener("click", toggleRightSidebarDesktop);
collapseTreeBtn.addEventListener("click", collapseAllTreeFolders);
refreshTreeBtn.addEventListener("click", () => {
    window.location.reload();
});
closeTreeBtn.addEventListener("click", () => {
    if (hideTreeUi) return;
    if (isSidebarOverlayMode()) {
        closePanels();
    } else {
        appEl.classList.add("left-collapsed");
        saveDesktopLayout();
        syncTopActionsOffset();
    }
});
closeTocBtn.addEventListener("click", () => {
    if (hideTocUi) return;
    if (isSidebarOverlayMode()) {
        closePanels();
    } else {
        appEl.classList.add("right-collapsed");
        saveDesktopLayout();
        syncTopActionsOffset();
    }
});
backdrop.addEventListener("click", closePanels);

mobileMedia.addEventListener("change", () => {
    closePanels();
    syncTopActionsOffset();
});

window.addEventListener("resize", syncTopActionsOffset);
window.addEventListener("resize", () => {
    if (!activePdfDoc || !articleWrapper.classList.contains("pdf-mode")) return;
    renderAllPdfPages().catch(() => {
        // Ignore transient render errors during resize.
    });
});
tocSidebar.addEventListener("transitionend", syncTopActionsOffset);

contentEl.addEventListener("scroll", () => {
    if (!currentFilePath) return;
    if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(() => {
        persistScrollPosition();
    }, 180);
});

window.addEventListener("beforeunload", persistScrollPosition);
themeToggleBtn.addEventListener("click", toggleTheme);
bindSidebarResizer(leftResizer, "left");
bindSidebarResizer(rightResizer, "right");

initTheme();
applyUiConfig();
closeSearchOverlay();
resetPageTitle();
applyDesktopLayoutFromStorage();
syncTopActionsOffset();
loadTree();
