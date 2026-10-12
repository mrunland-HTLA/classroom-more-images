/**
 * Background script — CSP fallback path.
 *
 * Only invoked if a grid iframe fails to load (i.e. the page's CSP
 * blocks framing drive.google.com from a content-script-injected element).
 * Fetches the preview as a blob using host_permissions clearance and
 * returns an Object URL to the content script.
 *
 * NOTE: This will only work for images the current Google session's
 * cookies are authorized to view — fetch() from the background context
 * still sends cookies for same-origin-authenticated requests in Firefox,
 * but this has NOT been tested against live Drive auth behavior. If it
 * doesn't work, the more reliable fallback is fetching a direct-download
 * export URL rather than the /preview HTML endpoint (which returns a
 * full HTML document, not raw image bytes) — see note below.
 */

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "FETCH_IMAGE_BLOB") return;

  // IMPORTANT: /file/d/<id>/preview returns an HTML viewer page, not
  // image bytes. For a true blob-image fallback you likely want Drive's
  // direct content export endpoint instead, e.g.:
  //   https://drive.google.com/uc?export=view&id=<FILE_ID>
  // Swap this URL if you confirm the export endpoint works for your
  // account's Classroom-attached files.
  const url = `https://drive.google.com/uc?export=view&id=${message.fileId}`;

  return fetch(url, { credentials: "include" })
    .then((res) => {
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      return { objectUrl };
    })
    .catch((err) => {
      return { error: err.message };
    });
});
