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

async function enhanceMarkdownContent(container) {
    await renderMermaidDiagrams(container);

    container.querySelectorAll("pre code").forEach(codeEl => {
        if (codeEl.dataset.hljsDone === "1") return;
        if (codeEl.classList.contains("language-mermaid")) return;
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
        scheduleAutoFitSidebar("right");
        return;
    }
    const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");

    if (!headings.length) {
        tocContainer.innerHTML = `<div class="empty-hint">No headings</div>`;
        scheduleAutoFitSidebar("right");
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
    scheduleAutoFitSidebar("right");
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
        await enhanceMarkdownContent(viewer);

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
        scheduleAutoFitSidebar("right");
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
        await enhanceMarkdownContent(viewer);

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
        scheduleAutoFitSidebar("right");
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
        scheduleAutoFitSidebar("right");
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
        scheduleAutoFitSidebar("left");

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
        scheduleAutoFitSidebar("left");
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
    appEl.classList.toggle("left-collapsed", hideTreeUi || appEl.classList.contains("left-collapsed"));
    appEl.classList.toggle("right-collapsed", hideTocUi || appEl.classList.contains("right-collapsed"));
    if (sidebar) sidebar.hidden = hideTreeUi;
    if (leftResizer) leftResizer.hidden = hideTreeUi;
    if (tocSidebar) tocSidebar.hidden = hideTocUi;
    if (rightResizer) rightResizer.hidden = hideTocUi;
    if (fixedFooter) {
        if (footerText) {
            fixedFooter.innerHTML = renderFooterHtml(footerText);
            fixedFooter.hidden = false;
        } else {
            fixedFooter.hidden = true;
        }
    }
    if (openSearchBtn) {
        openSearchBtn.hidden = !enableSearchUi;
    }
    if (downloadBtn) {
        downloadBtn.hidden = !enableDownloadUi;
    }
    if (themeToggleBtn) {
        themeToggleBtn.hidden = !enableThemeUi;
    }
    syncPanelToggleButtons();
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
    if (!enableSearchUi) return;
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

let imagePreviewOverlayEl = null;
let imagePreviewImgEl = null;
let imagePreviewZoomLabelEl = null;
let imagePreviewZoom = 1;
const IMAGE_PREVIEW_MIN_ZOOM = 0.2;
const IMAGE_PREVIEW_MAX_ZOOM = 5;
const IMAGE_PREVIEW_ZOOM_STEP = 1.2;

function clampImagePreviewZoom(value) {
    return clamp(value, IMAGE_PREVIEW_MIN_ZOOM, IMAGE_PREVIEW_MAX_ZOOM);
}

function applyImagePreviewZoom(nextZoom) {
    imagePreviewZoom = clampImagePreviewZoom(nextZoom);
    if (imagePreviewImgEl) {
        imagePreviewImgEl.style.transform = `scale(${imagePreviewZoom})`;
    }
    if (imagePreviewZoomLabelEl) {
        imagePreviewZoomLabelEl.textContent = `${Math.round(imagePreviewZoom * 100)}%`;
    }
}

function ensureImagePreviewOverlay() {
    if (imagePreviewOverlayEl) return;
    const overlay = document.createElement("div");
    overlay.id = "imagePreviewOverlay";
    overlay.className = "image-preview-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="image-preview-toolbar">
            <button class="image-preview-zoom-out" type="button" aria-label="Zoom out">−</button>
            <span class="image-preview-zoom-label">100%</span>
            <button class="image-preview-zoom-in" type="button" aria-label="Zoom in">+</button>
            <button class="image-preview-zoom-reset" type="button" aria-label="Reset zoom">100%</button>
        </div>
        <button class="image-preview-close" type="button" aria-label="Close image preview">✕</button>
        <div class="image-preview-dialog">
            <img class="image-preview-img" alt="Image preview" />
        </div>
    `;
    document.body.appendChild(overlay);
    imagePreviewOverlayEl = overlay;
    imagePreviewImgEl = overlay.querySelector(".image-preview-img");
    imagePreviewZoomLabelEl = overlay.querySelector(".image-preview-zoom-label");
    applyImagePreviewZoom(1);

    const closeBtn = overlay.querySelector(".image-preview-close");
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            closeImagePreview();
        });
    }
    const zoomInBtn = overlay.querySelector(".image-preview-zoom-in");
    if (zoomInBtn) {
        zoomInBtn.addEventListener("click", () => {
            applyImagePreviewZoom(imagePreviewZoom * IMAGE_PREVIEW_ZOOM_STEP);
        });
    }
    const zoomOutBtn = overlay.querySelector(".image-preview-zoom-out");
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener("click", () => {
            applyImagePreviewZoom(imagePreviewZoom / IMAGE_PREVIEW_ZOOM_STEP);
        });
    }
    const zoomResetBtn = overlay.querySelector(".image-preview-zoom-reset");
    if (zoomResetBtn) {
        zoomResetBtn.addEventListener("click", () => {
            applyImagePreviewZoom(1);
        });
    }
    if (imagePreviewImgEl) {
        imagePreviewImgEl.addEventListener("dblclick", (event) => {
            event.preventDefault();
            applyImagePreviewZoom(1);
        });
    }
    overlay.addEventListener("wheel", (event) => {
        if (overlay.hidden) return;
        event.preventDefault();
        const delta = event.deltaY;
        if (delta < 0) {
            applyImagePreviewZoom(imagePreviewZoom * IMAGE_PREVIEW_ZOOM_STEP);
        } else if (delta > 0) {
            applyImagePreviewZoom(imagePreviewZoom / IMAGE_PREVIEW_ZOOM_STEP);
        }
    }, { passive: false });
    overlay.addEventListener("click", (event) => {
        const target = event.target;
        if (target === overlay) {
            closeImagePreview();
        }
    });
}

function openImagePreview(src, altText = "") {
    if (!src) return;
    ensureImagePreviewOverlay();
    if (!imagePreviewOverlayEl || !imagePreviewImgEl) return;
    imagePreviewImgEl.src = src;
    imagePreviewImgEl.alt = altText || "Image preview";
    applyImagePreviewZoom(1);
    imagePreviewOverlayEl.hidden = false;
}

function closeImagePreview() {
    if (!imagePreviewOverlayEl || imagePreviewOverlayEl.hidden) return;
    imagePreviewOverlayEl.hidden = true;
    if (imagePreviewImgEl) {
        imagePreviewImgEl.style.removeProperty("transform");
        imagePreviewImgEl.removeAttribute("src");
    }
}

function isPreviewableContentImage(element) {
    if (!(element instanceof HTMLImageElement)) return false;
    if (!viewer || !viewer.contains(element)) return false;
    return !!(element.currentSrc || element.src);
}

function bindImagePreview() {
    if (!viewer) return;
    viewer.addEventListener("click", (event) => {
        const target = event.target;
        if (!isPreviewableContentImage(target)) return;
        event.preventDefault();
        const src = target.currentSrc || target.src;
        const altText = target.getAttribute("alt") || "";
        openImagePreview(src, altText);
    });
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
        if (!enableSearchUi) return;
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
    if ((event.key === "Escape" || event.key === "Esc") && imagePreviewOverlayEl && !imagePreviewOverlayEl.hidden) {
        closeImagePreview();
        return;
    }
    if (imagePreviewOverlayEl && !imagePreviewOverlayEl.hidden) {
        if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            applyImagePreviewZoom(imagePreviewZoom * IMAGE_PREVIEW_ZOOM_STEP);
            return;
        }
        if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            applyImagePreviewZoom(imagePreviewZoom / IMAGE_PREVIEW_ZOOM_STEP);
            return;
        }
        if (event.key === "0") {
            event.preventDefault();
            applyImagePreviewZoom(1);
            return;
        }
    }
    if ((event.key === "Escape" || event.key === "Esc") && searchOverlay && !searchOverlay.hidden) {
        closeSearchOverlay();
        return;
    }
    if (enableSearchUi && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearchOverlay();
    }
}, true);

openTreeBtn.addEventListener("click", toggleLeftSidebar);
openTocBtn.addEventListener("click", toggleRightSidebar);
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
        syncPanelToggleButtons();
    }
});
closeTocBtn.addEventListener("click", () => {
    if (hideTocUi) return;
    if (isSidebarOverlayMode()) {
        closePanels();
    } else {
        appEl.classList.add("right-collapsed");
        saveDesktopLayout();
        syncFabPosition();
        syncPanelToggleButtons();
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
bindImagePreview();

initTheme();
applyDesktopLayoutFromStorage();
applyUiConfig();
closeSearchOverlay();
resetPageTitle();
syncTopActionsOffset();
loadTree();
