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
    return !isMobile() && appEl.classList.contains("layout-docked");
}

function isSidebarOverlayMode() {
    return !isDockedDesktop();
}

function getLayoutMode() {
    return isMobile() ? "mobile" : "docked";
}

function getPreferredContentWidth() {
    return contentEl.classList.contains("pdf-content-mode")
        ? DESKTOP_PDF_CONTENT_MAX
        : DESKTOP_CONTENT_MAX;
}

function getDockedContentWidth() {
    const contentMax = getPreferredContentWidth();
    const minimumSideWidth = Math.max(MIN_LEFT_SIDEBAR, MIN_RIGHT_SIDEBAR);
    const available = window.innerWidth - (2 * (minimumSideWidth + DESKTOP_PANEL_GAP + DESKTOP_EDGE_PADDING));
    return clamp(available, DESKTOP_CONTENT_MIN, contentMax);
}

function getDockedSidebarMax(side) {
    const hardMin = side === "left" ? MIN_LEFT_SIDEBAR : MIN_RIGHT_SIDEBAR;
    const hardMax = side === "left" ? MAX_LEFT_SIDEBAR : MAX_RIGHT_SIDEBAR;
    const available = Math.floor((window.innerWidth - getDockedContentWidth()) / 2) - DESKTOP_PANEL_GAP - DESKTOP_EDGE_PADDING;
    return Math.max(hardMin, Math.min(hardMax, available));
}

function getSidebarBounds(side) {
    const isLeft = side === "left";
    const hardMin = isLeft ? MIN_LEFT_SIDEBAR : MIN_RIGHT_SIDEBAR;
    const hardMax = isLeft ? MAX_LEFT_SIDEBAR : MAX_RIGHT_SIDEBAR;
    if (!isDockedDesktop()) {
        return { min: hardMin, max: hardMax };
    }
    const max = getDockedSidebarMax(side);
    return { min: hardMin, max };
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
        leftAuto: leftSidebarAutoWidth,
        rightAuto: rightSidebarAutoWidth,
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
        leftSidebarAutoWidth = parsed.leftAuto !== false;
        rightSidebarAutoWidth = parsed.rightAuto !== false;
        appEl.classList.toggle("left-collapsed", hideTreeUi || !!parsed.leftCollapsed);
        appEl.classList.toggle("right-collapsed", hideTocUi || !!parsed.rightCollapsed);
        setSidebarWidthVars(Number(parsed.leftWidth), Number(parsed.rightWidth));
    } catch {
        leftSidebarAutoWidth = true;
        rightSidebarAutoWidth = true;
        appEl.classList.toggle("left-collapsed", hideTreeUi);
        appEl.classList.toggle("right-collapsed", hideTocUi);
    }
}

function measurePreferredSidebarWidth(side) {
    const bounds = getSidebarBounds(side);
    const selectors = side === "left"
        ? [".sidebar-header", ".tree-label"]
        : [".toc-header", ".toc-item", ".empty-hint"];
    const buffer = side === "left"
        ? LEFT_SIDEBAR_AUTO_FIT_BUFFER
        : RIGHT_SIDEBAR_AUTO_FIT_BUFFER;
    const autoFitMax = side === "left"
        ? Math.min(bounds.max, LEFT_SIDEBAR_AUTO_FIT_MAX)
        : Math.min(bounds.max, RIGHT_SIDEBAR_AUTO_FIT_MAX);
    const root = side === "left" ? sidebar : tocSidebar;
    if (!root) return bounds.min;

    let maxWidth = 0;
    selectors.forEach((selector) => {
        root.querySelectorAll(selector).forEach((el) => {
            maxWidth = Math.max(maxWidth, el.scrollWidth || 0);
        });
    });

    if (!maxWidth) return bounds.min;
    return clamp(maxWidth + buffer, bounds.min, autoFitMax);
}

function autoFitSidebarWidth(side) {
    if (!isDockedDesktop()) return;
    if ((side === "left" && (hideTreeUi || !leftSidebarAutoWidth))
        || (side === "right" && (hideTocUi || !rightSidebarAutoWidth))) {
        return;
    }

    const nextWidth = measurePreferredSidebarWidth(side);
    if (side === "left") {
        setSidebarWidthVars(nextWidth, NaN);
    } else {
        setSidebarWidthVars(NaN, nextWidth);
        syncFabPosition(getDockedContentWidth(), nextWidth);
    }
}

function scheduleAutoFitSidebar(side) {
    if (side === "left") {
        if (leftAutoFitFrame) cancelAnimationFrame(leftAutoFitFrame);
        leftAutoFitFrame = requestAnimationFrame(() => {
            leftAutoFitFrame = 0;
            autoFitSidebarWidth("left");
        });
        return;
    }

    if (rightAutoFitFrame) cancelAnimationFrame(rightAutoFitFrame);
    rightAutoFitFrame = requestAnimationFrame(() => {
        rightAutoFitFrame = 0;
        autoFitSidebarWidth("right");
    });
}

function syncFabPosition(contentWidthOverride = NaN, rightWidthOverride = NaN) {
    const docked = isDockedDesktop();
    const contentWidth = Number.isFinite(contentWidthOverride)
        ? contentWidthOverride
        : (docked
            ? getDockedContentWidth()
            : Math.min(getPreferredContentWidth(), Math.max(320, window.innerWidth - 48)));
    const { rightWidth } = getSidebarWidths();
    const effectiveRightWidth = docked && !hideTocUi && !appEl.classList.contains("right-collapsed")
        ? (Number.isFinite(rightWidthOverride) ? rightWidthOverride : rightWidth)
        : 0;
    const outerMargin = Math.max(0, (window.innerWidth - contentWidth) / 2);
    const whitespaceToRight = Math.max(0, outerMargin - effectiveRightWidth);
    const fabWidth = fabStack ? Math.max(48, Math.ceil(fabStack.getBoundingClientRect().width || 0)) : 56;
    const fabRight = docked
        ? (whitespaceToRight >= Math.max(FAB_OUTSIDE_MIN_SPACE, fabWidth + (2 * FAB_OUTSIDE_GUTTER))
            ? Math.max(effectiveRightWidth + FAB_OUTSIDE_GUTTER, outerMargin - fabWidth - FAB_OUTSIDE_GUTTER)
            : outerMargin + FAB_INSIDE_GUTTER)
        : FAB_INSIDE_GUTTER;

    appEl.style.setProperty("--fab-right", `${Math.round(fabRight)}px`);
}

function syncPanelToggleButtons() {
    const overlayMode = isSidebarOverlayMode();
    const leftVisible = !hideTreeUi;
    const rightVisible = !hideTocUi;
    const leftActive = leftVisible && (overlayMode
        ? sidebar.classList.contains("open")
        : !appEl.classList.contains("left-collapsed"));
    const rightActive = rightVisible && (overlayMode
        ? tocSidebar.classList.contains("open")
        : !appEl.classList.contains("right-collapsed"));

    if (openTreeBtn) {
        openTreeBtn.hidden = !leftVisible;
        openTreeBtn.disabled = !leftVisible;
        if (leftVisible) {
            const label = leftActive ? "Hide files" : "Show files";
            openTreeBtn.title = label;
            openTreeBtn.setAttribute("aria-label", label);
            openTreeBtn.setAttribute("aria-pressed", leftActive ? "true" : "false");
        } else {
            openTreeBtn.removeAttribute("aria-pressed");
        }
    }
    if (openTocBtn) {
        openTocBtn.hidden = !rightVisible;
        openTocBtn.disabled = !rightVisible;
        if (rightVisible) {
            const label = rightActive ? "Hide TOC" : "Show TOC";
            openTocBtn.title = label;
            openTocBtn.setAttribute("aria-label", label);
            openTocBtn.setAttribute("aria-pressed", rightActive ? "true" : "false");
        } else {
            openTocBtn.removeAttribute("aria-pressed");
        }
    }
}

function toggleLeftSidebar() {
    if (hideTreeUi) return;
    if (isDockedDesktop()) {
        appEl.classList.toggle("left-collapsed");
        saveDesktopLayout();
        syncPanelToggleButtons();
        return;
    }
    if (sidebar.classList.contains("open")) {
        closePanels();
    } else {
        openTreePanel();
    }
}

function toggleRightSidebar() {
    if (hideTocUi) return;
    if (isDockedDesktop()) {
        appEl.classList.toggle("right-collapsed");
        saveDesktopLayout();
        syncFabPosition();
        syncPanelToggleButtons();
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
        const collapseThreshold = minWidth - SIDEBAR_COLLAPSE_DRAG;
        const contentWidth = getDockedContentWidth();

        if (rawWidth <= collapseThreshold) {
            appEl.classList.add(collapsedClass);
            syncFabPosition(contentWidth, isLeft ? NaN : 0);
        } else {
            const nextWidth = clamp(rawWidth, minWidth, maxWidth);
            appEl.classList.remove(collapsedClass);
            if (isLeft) {
                setSidebarWidthVars(nextWidth, NaN);
            } else {
                setSidebarWidthVars(NaN, nextWidth);
            }
            syncFabPosition(contentWidth, isLeft ? NaN : nextWidth);
        }
        syncPanelToggleButtons();
    };

    const onUp = () => {
        if (!active) return;
        active = false;
        pointerId = null;
        resizerEl.classList.remove("active");
        document.body.style.userSelect = "";
        if (!appEl.classList.contains(collapsedClass)) {
            if (isLeft) {
                leftSidebarAutoWidth = false;
            } else {
                rightSidebarAutoWidth = false;
            }
        }
        saveDesktopLayout();
        syncPanelToggleButtons();
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
    const mode = getLayoutMode();
    const docked = mode === "docked";
    const contentWidth = docked
        ? getDockedContentWidth()
        : Math.min(getPreferredContentWidth(), Math.max(320, window.innerWidth - 48));
    const { leftWidth, rightWidth } = getSidebarWidths();

    appEl.classList.toggle("layout-docked", docked);
    appEl.classList.toggle("layout-mobile", mode === "mobile");
    appEl.style.setProperty("--content-track-width", `${Math.round(contentWidth)}px`);

    setSidebarWidthVars(leftWidth, rightWidth);
    if (leftSidebarAutoWidth) scheduleAutoFitSidebar("left");
    if (rightSidebarAutoWidth) scheduleAutoFitSidebar("right");
    syncFabPosition(contentWidth, rightWidth);

    if (docked) {
        closePanels();
    }
    syncPanelToggleButtons();
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
    syncPanelToggleButtons();
}

function openTreePanel() {
    if (hideTreeUi) return;
    if (!isSidebarOverlayMode()) return;
    sidebar.classList.add("open");
    tocSidebar.classList.remove("open");
    backdrop.classList.add("show");
    document.body.style.overflow = "hidden";
    syncPanelToggleButtons();
}

function openTocPanel() {
    if (hideTocUi) return;
    if (!isSidebarOverlayMode()) return;
    tocSidebar.classList.add("open");
    sidebar.classList.remove("open");
    backdrop.classList.add("show");
    document.body.style.overflow = "hidden";
    syncPanelToggleButtons();
}
