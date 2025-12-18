import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

(() => {
  const els = {
    fileLeft: document.getElementById("fileLeft"),
    fileRight: document.getElementById("fileRight"),

    leftCanvas: document.getElementById("leftCanvas"),
    rightCanvas: document.getElementById("rightCanvas"),

    leftViewer: document.getElementById("leftViewer"),
    rightViewer: document.getElementById("rightViewer"),

    leftStatus: document.getElementById("leftStatus"),
    rightStatus: document.getElementById("rightStatus"),

    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    pageInput: document.getElementById("pageInput"),
    pageCount: document.getElementById("pageCount"),

    zoomOutBtn: document.getElementById("zoomOutBtn"),
    zoomInBtn: document.getElementById("zoomInBtn"),
    zoomLabel: document.getElementById("zoomLabel"),

    syncToggle: document.getElementById("syncToggle"),
  };

  const state = {
    left: { pdf: null, pages: 0, rendering: false, pending: null },
    right:{ pdf: null, pages: 0, rendering: false, pending: null },
    page: 1,
    zoom: 1.0,
    activeSide: "left",
  };

  const DPR = () => Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  function bothLoaded() {
    return !!(state.left.pdf && state.right.pdf);
  }

  function anyLoaded() {
    return !!(state.left.pdf || state.right.pdf);
  }

  function maxCommonPages() {
    if (!state.left.pdf && !state.right.pdf) return 0;
    if (state.left.pdf && state.right.pdf) return Math.min(state.left.pages, state.right.pages);
    return state.left.pdf ? state.left.pages : state.right.pages;
  }

  function clampPage(p) {
    const maxP = maxCommonPages();
    if (!maxP) return 1;
    return Math.max(1, Math.min(maxP, p));
  }

  function setControlsEnabled(enabled) {
    els.prevBtn.disabled = !enabled;
    els.nextBtn.disabled = !enabled;
    els.pageInput.disabled = !enabled;
    els.zoomOutBtn.disabled = !enabled;
    els.zoomInBtn.disabled = !enabled;
  }

  function updatePagerUI() {
    const maxP = maxCommonPages();
    els.pageCount.textContent = maxP ? String(maxP) : "—";
    els.pageInput.value = String(state.page);
    els.prevBtn.disabled = !anyLoaded() || state.page <= 1;
    els.nextBtn.disabled = !anyLoaded() || (maxP ? state.page >= maxP : true);
    els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function status(side, text) {
    (side === "left" ? els.leftStatus : els.rightStatus).textContent = text;
  }

  async function loadPdfFromFile(file) {
    const buf = await file.arrayBuffer();
    const task = pdfjsLib.getDocument({ data: buf });
    return await task.promise;
  }

  function normalizeCanvas(canvas, viewport) {
    const dpr = DPR();
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  async function renderSide(side, pageNum, zoom) {
    const s = state[side];
    const canvas = side === "left" ? els.leftCanvas : els.rightCanvas;
    if (!s.pdf) return;

    if (s.rendering) {
      s.pending = { pageNum, zoom };
      return;
    }

    s.rendering = true;
    try {
      const page = await s.pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoom });
      const ctx = normalizeCanvas(canvas, viewport);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } finally {
      s.rendering = false;
      if (s.pending) {
        const { pageNum: p, zoom: z } = s.pending;
        s.pending = null;
        renderSide(side, p, z);
      }
    }
  }

  async function renderAll() {
    const p = state.page;
    const z = state.zoom;
    await Promise.allSettled([
      state.left.pdf ? renderSide("left", p, z) : Promise.resolve(),
      state.right.pdf ? renderSide("right", p, z) : Promise.resolve(),
    ]);
  }

  function setPage(newPage) {
    state.page = clampPage(newPage);
    updatePagerUI();
    renderAll();
  }

  function setZoom(newZoom) {
    state.zoom = Math.max(0.25, Math.min(4.0, newZoom));
    updatePagerUI();
    renderAll();
  }

  async function onPick(side, file) {
    if (!file) return;
    status(side, "Loading…");

    try {
      const pdf = await loadPdfFromFile(file);
      state[side].pdf = pdf;
      state[side].pages = pdf.numPages;
      status(side, `${file.name} • ${pdf.numPages} pages`);
    } catch (e) {
      console.error(e);
      state[side].pdf = null;
      state[side].pages = 0;
      status(side, "Failed to load PDF");
    }

    setControlsEnabled(anyLoaded());
    state.page = clampPage(state.page);
    updatePagerUI();
    renderAll();
  }

  // Wheel paging
  async function wheelIndependent(side, ev) {
    if (!anyLoaded()) return;
    if (ev.ctrlKey || ev.metaKey) return;

    const dy = ev.deltaY;
    if (Math.abs(dy) < 20) return;
    ev.preventDefault();
    const dir = dy > 0 ? 1 : -1;

    if (els.syncToggle.checked) {
      setPage(state.page + dir);
      return;
    }

    const s = state[side];
    if (!s.pdf) return;

    const next = Math.max(1, Math.min(s.pages, state.page + dir));
    state.page = next;
    updatePagerUI();
    await renderSide(side, next, state.zoom);
  }

  function setActiveSide(side) {
    state.activeSide = side;
  }

  async function pageByKeyboard(delta) {
    if (els.syncToggle.checked) {
      setPage(state.page + delta);
      return;
    }

    const side = state.activeSide || "left";
    const s = state[side];
    if (!s || !s.pdf) return;

    const next = Math.max(1, Math.min(s.pages, state.page + delta));
    state.page = next;
    updatePagerUI();
    await renderSide(side, next, state.zoom);
  }

  // Events
  els.fileLeft.addEventListener("change", (e) => onPick("left", e.target.files?.[0]));
  els.fileRight.addEventListener("change", (e) => onPick("right", e.target.files?.[0]));

  els.prevBtn.addEventListener("click", () => setPage(state.page - 1));
  els.nextBtn.addEventListener("click", () => setPage(state.page + 1));

  els.pageInput.addEventListener("change", () => setPage(parseInt(els.pageInput.value || "1", 10)));
  els.pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") setPage(parseInt(els.pageInput.value || "1", 10));
  });

  els.zoomOutBtn.addEventListener("click", () => setZoom(state.zoom / 1.1));
  els.zoomInBtn.addEventListener("click", () => setZoom(state.zoom * 1.1));

  els.leftViewer.addEventListener("wheel", (ev) => wheelIndependent("left", ev), { passive: false });
  els.rightViewer.addEventListener("wheel", (ev) => wheelIndependent("right", ev), { passive: false });

  ["pointerdown", "mouseenter", "focusin"].forEach((evt) => {
    els.leftViewer.addEventListener(evt, () => setActiveSide("left"));
    els.rightViewer.addEventListener(evt, () => setActiveSide("right"));
  });

  window.addEventListener("keydown", (e) => {
    if (!anyLoaded()) return;

    if (e.key === "ArrowLeft") { e.preventDefault(); pageByKeyboard(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); pageByKeyboard(1); }

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === "+" || e.key === "=")) { e.preventDefault(); setZoom(state.zoom * 1.1); }
    if (ctrl && (e.key === "-" || e.key === "_")) { e.preventDefault(); setZoom(state.zoom / 1.1); }
    if (ctrl && (e.key === "0")) { e.preventDefault(); setZoom(1.0); }
  });

  els.syncToggle.addEventListener("change", () => {
    if (els.syncToggle.checked && bothLoaded()) state.page = clampPage(state.page);
    updatePagerUI();
    renderAll();
  });

  // Initial UI
  setControlsEnabled(false);
  updatePagerUI();
})();