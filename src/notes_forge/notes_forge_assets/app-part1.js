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
const fabStack = document.querySelector(".fab-stack");
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
const mobileMedia = window.matchMedia("(max-width: 1375px)");
const STORAGE_KEY = "md-browser-reading-state";
const THEME_KEY = "md-browser-theme";
const LAYOUT_KEY = "md-browser-desktop-layout";
const BASE_TITLE = "Notes Forge";
const MIN_LEFT_SIDEBAR = 220;
const MAX_LEFT_SIDEBAR = 560;
const MIN_RIGHT_SIDEBAR = 220;
const MAX_RIGHT_SIDEBAR = 520;
const DESKTOP_CONTENT_MIN = 880;
const DESKTOP_CONTENT_MAX = 1120;
const DESKTOP_PDF_CONTENT_MAX = 1300;
const DESKTOP_PANEL_GAP = 16;
const DESKTOP_EDGE_PADDING = 0;
const DESKTOP_RESIZER_SIZE = 18;
const SIDEBAR_COLLAPSE_DRAG = 44;
const LEFT_SIDEBAR_AUTO_FIT_BUFFER = 8;
const RIGHT_SIDEBAR_AUTO_FIT_BUFFER = 14;
const LEFT_SIDEBAR_AUTO_FIT_MAX = 340;
const RIGHT_SIDEBAR_AUTO_FIT_MAX = 320;
const FAB_INSIDE_GUTTER = 18;
const FAB_OUTSIDE_GUTTER = 12;
const FAB_OUTSIDE_MIN_SPACE = 76;
let scrollSaveTimer = null;
let hljsReadyPromise = null;
let mermaidReadyPromise = null;
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
let leftSidebarAutoWidth = true;
let rightSidebarAutoWidth = true;
let leftAutoFitFrame = 0;
let rightAutoFitFrame = 0;
const HLJS_VERSION = "11.8.0";
const MERMAID_VERSION = "11.4.1";
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

function ensureMermaidReady() {
    if (window.mermaid && typeof window.mermaid.run === "function") {
        return Promise.resolve(window.mermaid);
    }
    if (mermaidReadyPromise) return mermaidReadyPromise;

    const cdnList = [
        `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`,
        `https://unpkg.com/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`,
        `https://cdnjs.cloudflare.com/ajax/libs/mermaid/${MERMAID_VERSION}/mermaid.min.js`,
    ];

    mermaidReadyPromise = new Promise((resolve) => {
        let idx = 0;
        const tryLoad = () => {
            if (window.mermaid && typeof window.mermaid.run === "function") {
                window.mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: "loose",
                    theme: document.body.classList.contains("dark") ? "dark" : "default",
                });
                resolve(window.mermaid);
                return;
            }
            if (idx >= cdnList.length) {
                resolve(null);
                return;
            }
            const script = document.createElement("script");
            script.src = cdnList[idx++];
            script.async = true;
            script.onload = tryLoad;
            script.onerror = tryLoad;
            document.head.appendChild(script);
        };
        tryLoad();
    });

    return mermaidReadyPromise;
}

async function renderMermaidDiagrams(container) {
    const mermaidBlocks = container.querySelectorAll("pre code.language-mermaid");
    if (!mermaidBlocks.length) return;

    mermaidBlocks.forEach((codeEl) => {
        const pre = codeEl.closest("pre");
        if (!pre || pre.dataset.mermaidDone === "1") return;
        const source = codeEl.textContent || "";
        const target = document.createElement("div");
        target.className = "mermaid";
        target.textContent = source;
        pre.replaceWith(target);
        pre.dataset.mermaidDone = "1";
    });

    const mermaidApi = await ensureMermaidReady();
    if (!mermaidApi) return;

    const nodes = Array.from(container.querySelectorAll(".mermaid"));
    if (!nodes.length) return;
    await mermaidApi.run({ nodes });
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
