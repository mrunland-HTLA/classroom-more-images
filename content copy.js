/**
 * Google Classroom Multi-Image Grid — content script
 *
 * collectFileIds() below is verified against real Classroom markup
 * (see comment inline). findNativeViewer() is still an unverified
 * heuristic (largest iframe on the page) — marked "// VERIFY:" below.
 * Classroom's class names are minified/obfuscated and CAN change over
 * time (see design doc, Challenge 2), so if this stops working after a
 * Google UI update, re-inspect the DOM and adjust collectFileIds().
 */

(function () {
  const MAX_IMAGES = 4;
  const GRID_ID = "classroom-multi-grid";

  let currentObserver = null;
  let lastStudentKey = null;

  function log(...args) {
    console.log("[Classroom Multi-Grid]", ...args);
  }

  // ---------------------------------------------------------------------
  // 1. Extract a "student key" from the URL hash so we can detect
  //    navigation between students (next/prev arrows) without a full
  //    page reload. Example hash: #u=ODE5OTMxMzUxMTg5&t=f
  // ---------------------------------------------------------------------
  function getStudentKeyFromHash() {
    const hash = window.location.hash; // e.g. "#u=ODE5OTMxMzUxMTg5&t=f"
    const match = hash.match(/u=([^&]+)/);
    return match ? match[1] : hash || window.location.pathname;
  }

  // ---------------------------------------------------------------------
  // 2 & 3. Locate image attachments and extract their Drive File IDs.
  //
  //    Confirmed from live DOM that the *focused/active* attachment (the
  //    one currently open in the viewer) renders differently from the
  //    other three:
  //
  //    Focused item:
  //      <span aria-label='Open "IMG_....jpg" in new window' ...>
  //        <div data-url="https://drive.google.com/file/d/FILE_ID/view?..." ...>
  //
  //    Non-focused items:
  //      <div aria-hidden="true">
  //        <div aria-label="Open in new window" ...>
  //          <a href="https://drive.google.com/file/d/FILE_ID/view?..."
  //             aria-label='Open "IMG_....jpg" in new window' ...>
  //
  //    So we collect BOTH shapes: any [data-url] carrying a Drive file URL,
  //    and any <a href> carrying one, then filter to images via whichever
  //    aria-label (on the node itself, or its nearest ancestor) contains
  //    a recognizable image filename extension.
  // ---------------------------------------------------------------------
  const IMAGE_EXTENSION_RE = /\.(jpe?g|png|gif|webp|bmp|heic)["\s]/i;
  const DRIVE_FILE_URL_RE = /\/file\/d\/([a-zA-Z0-9_-]+)/;

  function collectFileIds() {
    const candidates = [
      ...document.querySelectorAll('[data-url*="drive.google.com/file/d/"]'),
      ...document.querySelectorAll('a[href*="drive.google.com/file/d/"]'),
    ];

    const seen = new Set();
    const ids = [];

    for (const node of candidates) {
      if (ids.length >= MAX_IMAGES) break;

      const url = node.getAttribute("data-url") || node.getAttribute("href") || "";
      const ownLabel = node.getAttribute("aria-label");
      const label = ownLabel || node.closest("[aria-label]")?.getAttribute("aria-label") || "";

      // Only keep attachments whose filename (from the aria-label) looks
      // like an image. Skip PDFs, docs, etc.
      if (!IMAGE_EXTENSION_RE.test(label + " ")) continue;

      const match = url.match(DRIVE_FILE_URL_RE);
      if (!match) continue;

      const fileId = match[1];
      if (seen.has(fileId)) continue;

      seen.add(fileId);
      ids.push(fileId);
    }

    log(`Found ${ids.length} image file id(s):`, ids);
    return ids;
  }

  // ---------------------------------------------------------------------
  // 4. Locate the native single-file preview viewer so we can hide it.
  //    VERIFY: Classroom's central preview is generally a single large
  //    iframe; adjust selector if it's a different element type.
  // ---------------------------------------------------------------------
  function findNativeViewer() {
    // Look for the largest iframe on the page as a heuristic, excluding
    // any grid we may have already injected.
    const iframes = Array.from(document.querySelectorAll("iframe")).filter(
      (f) => !f.closest(`#${GRID_ID}`)
    );
    if (iframes.length === 0) return null;

    iframes.sort((a, b) => {
      const areaA = a.clientWidth * a.clientHeight;
      const areaB = b.clientWidth * b.clientHeight;
      return areaB - areaA;
    });
    return iframes[0];
  }

  // ---------------------------------------------------------------------
  // 5. Build the grid and inject iframes pointed at Drive's embeddable
  //    preview endpoint.
  // ---------------------------------------------------------------------
  function buildGrid(fileIds) {
    removeGrid();

    const nativeViewer = findNativeViewer();
    if (!nativeViewer || !nativeViewer.parentElement) {
      log("Could not locate native viewer to anchor the grid.");
      return;
    }

    nativeViewer.dataset.multiGridHidden = "true";
    nativeViewer.style.display = "none";

    const grid = document.createElement("div");
    grid.id = GRID_ID;

    fileIds.forEach((id) => {
      const frame = document.createElement("iframe");
      frame.className = "grid-image-item";
      frame.src = `https://drive.google.com/file/d/${id}/preview`;
      frame.setAttribute("allow", "autoplay");
      frame.addEventListener("error", () => handleFrameFailure(id, frame));
      grid.appendChild(frame);
    });

    nativeViewer.parentElement.insertBefore(grid, nativeViewer);
  }

  function removeGrid() {
    const existing = document.getElementById(GRID_ID);
    if (existing) existing.remove();

    // Restore any hidden native viewer in case the new student has 0 or 1
    // image attachments and we want to fall back to default behavior.
    const hidden = document.querySelector('[data-multi-grid-hidden="true"]');
    if (hidden) {
      hidden.style.display = "";
      delete hidden.dataset.multiGridHidden;
    }
  }

  // ---------------------------------------------------------------------
  // 6. CSP fallback: if a grid iframe fails to load (blocked by the
  //    host page's frame-src CSP), ask the background script to fetch
  //    the image as a blob and swap in an <img> instead.
  // ---------------------------------------------------------------------
  function handleFrameFailure(fileId, frameEl) {
    log(`Iframe blocked or failed for ${fileId}, requesting blob fallback.`);
    browser.runtime
      .sendMessage({ type: "FETCH_IMAGE_BLOB", fileId })
      .then((response) => {
        if (response && response.objectUrl) {
          const img = document.createElement("img");
          img.className = "grid-image-item";
          img.src = response.objectUrl;
          frameEl.replaceWith(img);
        } else {
          log(`Blob fallback failed for ${fileId}:`, response && response.error);
        }
      })
      .catch((err) => log("Message to background failed:", err));
  }

  // ---------------------------------------------------------------------
  // 7. Main scan/render cycle.
  // ---------------------------------------------------------------------
  function runScan() {
    const ids = collectFileIds();
    if (ids.length > 1) {
      // Only worth showing a grid when there's more than one image;
      // otherwise let Classroom's native single viewer handle it.
      buildGrid(ids);
    } else {
      removeGrid();
    }
  }

  // ---------------------------------------------------------------------
  // 8. SPA navigation handling. Classroom swaps student context via the
  //    URL hash and in-place DOM updates without a full reload, so we
  //    watch both hashchange and a MutationObserver on a stable
  //    top-level region as a fallback in case hash timing is unreliable.
  //    VERIFY: pick a genuinely stable top-level container to observe;
  //    document.body is a safe but noisy fallback used here.
  // ---------------------------------------------------------------------
  function onPossibleNavigation() {
    const key = getStudentKeyFromHash();
    if (key === lastStudentKey) return;
    lastStudentKey = key;
    log("Detected student change:", key);

    // Give Classroom's own re-render a moment to finish before we scan.
    setTimeout(runScan, 400);
  }

  function initObservers() {
    window.addEventListener("hashchange", onPossibleNavigation);

    currentObserver = new MutationObserver(() => {
      onPossibleNavigation();
    });
    currentObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    lastStudentKey = getStudentKeyFromHash();
    initObservers();
    // Initial scan once the page has settled.
    setTimeout(runScan, 800);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }

  // ---------------------------------------------------------------------
  // Debug hook: functions above are scoped inside this IIFE, so they're
  // not visible to the page console by default. Exposing them here lets
  // you run e.g. `__classroomMultiGrid.collectFileIds()` directly while
  // testing, instead of only relying on the automatic console.log lines.
  // Safe to delete once selectors are stable.
  // ---------------------------------------------------------------------
  window.__classroomMultiGrid = {
    collectFileIds,
    runScan,
    findNativeViewer,
    removeGrid,
  };

  log("Content script loaded and initialized.");
})();

