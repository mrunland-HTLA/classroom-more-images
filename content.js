/**
 * Google Classroom Multi-Image Grid — Final Production Script
 */

(function () {
  const MAX_IMAGES = 4;
  const GRID_ID = "classroom-multi-grid";

  let currentObserver = null;
  let lastStudentKey = null;

  function log(...args) {
    console.log("[Classroom Multi-Grid]", ...args);
  }

  function getStudentKeyFromHash() {
    const hash = window.location.hash;
    const match = hash.match(/u=([^&]+)/);
    return match ? match[1] : hash || window.location.pathname;
  }

  const IMAGE_EXTENSION_RE = /\.(jpe?g|png|gif|webp|bmp|heic)/i;
  const DRIVE_FILE_URL_RE = /\/file\/d\/([a-zA-Z0-9_-]+)/;

  function collectFileIds() {
    // Phase 1: Wide-net scan including the active focused span element shape
    const candidates = [
      ...document.querySelectorAll('[guidedhelpid="openInNewItemGH"]'),
 ...document.querySelectorAll('[title="Open in new window"]'),
 ...document.querySelectorAll('.clmEye'),
 ...document.querySelectorAll('[aria-label*="Open \\""][aria-label*="\\" in new window"]')
    ];

    const seen = new Set();
    const ids = [];

    for (const node of candidates) {
      if (ids.length >= MAX_IMAGES) break;

      let url = node.getAttribute("data-url") || node.getAttribute("href") || "";

      if (!url && node.parentElement) {
        url = node.parentElement.getAttribute("data-url") || node.parentElement.getAttribute("href") || "";
      }
      // If matching the active item span, check its immediate children
      if (!url) {
        const internalNode = node.querySelector('[data-url], [href]');
        if (internalNode) {
          url = internalNode.getAttribute("data-url") || internalNode.getAttribute("href") || "";
        }
      }

      if (!url) continue;

      const ownLabel = node.getAttribute("aria-label") || node.getAttribute("title") || "";
      const parentLabel = node.closest("[aria-label]")?.getAttribute("aria-label") || "";
      const textLabel = node.closest(".clmEye")?.parentElement?.textContent || "";
      const combinedLabel = `${ownLabel} ${parentLabel} ${textLabel}`;

      if (!IMAGE_EXTENSION_RE.test(combinedLabel) && !combinedLabel.toLowerCase().includes("image")) {
        continue;
      }

      const match = url.match(DRIVE_FILE_URL_RE);
      if (!match || !match[1]) continue;

      const fileId = match[1];

      if (!seen.has(fileId)) {
        seen.add(fileId);
        ids.push(fileId);
      }
    }

    log(`Filtering step complete. Successfully isolated ${ids.length} unique image ID(s):`, ids);
    return ids;
  }

  function findNativeViewer() {
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

  function buildGrid(fileIds) {
    removeGrid();

    const nativeViewer = findNativeViewer();
    if (!nativeViewer || !nativeViewer.parentElement) {
      log("Unable to identify native view viewport to target anchor.");
      return;
    }

    const containerWrapper = nativeViewer.parentElement;
    containerWrapper.style.position = "relative";

    const grid = document.createElement("div");
    grid.id = GRID_ID;

    fileIds.forEach((fileId) => {
      const frame = document.createElement("iframe");

      // Mirror the precise security parameters Google Classroom uses natively
      frame.className = "grid-image-item";
      frame.id = "material-iframe-grid-" + fileId;
      frame.src = "https://docs.google.com/file/d/" + fileId + "/grading?authuser=0&allow_parent=https%3A%2F%2Fclassroom.google.com&enable_comments=true";

      // Copy over the explicit permission sandbox flags to satisfy Firefox CSP policies
      frame.setAttribute("allow", "accelerometer *; ambient-light-sensor *; autoplay *; camera *; encrypted-media *; fullscreen *; geolocation *; gyroscope *; magnetometer *; microphone *; midi *; payment *; picture-in-picture *; speaker *; usb *; vr *;");

      grid.appendChild(frame);
    });

    containerWrapper.appendChild(grid);
  }

  function removeGrid() {
    const existing = document.getElementById(GRID_ID);
    if (existing) existing.remove();
  }

  function runScan() {
    const ids = collectFileIds();
    if (ids.length > 1) {
      buildGrid(ids);
    } else {
      removeGrid();
    }
  }

  function onPossibleNavigation() {
    const key = getStudentKeyFromHash();
    if (key === lastStudentKey) return;
    lastStudentKey = key;
    log("Context updated to student key identifier:", key);

    setTimeout(runScan, 600); // 600ms yield buffer allows the DOM stream to settle fully
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
    setTimeout(runScan, 1000);
  }

  window.__classroomMultiGrid = {
    collectFileIds,
 runScan,
 findNativeViewer,
 removeGrid,
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
