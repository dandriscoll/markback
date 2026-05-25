// MarkBack — markdown preview injection (v0.2.0 MVP).
// Runs inside the VS Code markdown preview's webview. Plain JS, no
// module imports. Sole purpose: render a floating "💬 Comment" button
// when the user selects text in the preview, and route the click into
// the markback.previewComment command via a `command:` URI link.
//
// One-way bridge only: preview -> extension. Existing comments are not
// rendered in the preview yet (v0.2.1 task).

(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.__markback_preview_injected__) return;
  window.__markback_preview_injected__ = true;

  var SOURCE_URI = resolveSourceUri();
  if (!SOURCE_URI) {
    console.log("[markback] could not resolve source URI; preview commenting disabled");
    return;
  }

  var BUTTON_ID = "markback-preview-button";
  var button = null;

  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("selectionchange", scheduleMaybeShow);

  function onMouseDown(e) {
    if (!button) return;
    if (e.target === button || (button.contains && button.contains(e.target))) return;
    removeButton();
  }

  function onMouseUp(_e) {
    scheduleMaybeShow();
  }

  var scheduled = false;
  function scheduleMaybeShow() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      maybeShowButton();
    }, 50);
  }

  function maybeShowButton() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      removeButton();
      return;
    }
    var range = sel.getRangeAt(0);
    if (isInsideButton(range.startContainer) || isInsideButton(range.endContainer)) {
      return;
    }
    var lines = lineRangeForSelection(range);
    if (lines === null) {
      removeButton();
      return;
    }
    var selectionText = sel.toString();
    if (!selectionText || selectionText.trim().length === 0) {
      removeButton();
      return;
    }
    showButton(range, lines, selectionText);
  }

  function isInsideButton(node) {
    while (node) {
      if (node.id === BUTTON_ID) return true;
      node = node.parentNode;
    }
    return false;
  }

  // Walk up from `node` to find the nearest element with [data-line].
  // VS Code's markdown extension injects data-line on rendered block
  // elements. Returns the integer line number, or null.
  function lineFor(node) {
    while (node && node.nodeType !== 1) node = node.parentNode;
    while (node) {
      if (node.getAttribute) {
        var v = node.getAttribute("data-line");
        if (v !== null && v !== "") {
          var n = parseInt(v, 10);
          if (!isNaN(n)) return n;
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  function lineRangeForSelection(range) {
    var startLine = lineFor(range.startContainer);
    var endLine = lineFor(range.endContainer);
    if (startLine === null && endLine === null) return null;
    if (startLine === null) startLine = endLine;
    if (endLine === null) endLine = startLine;
    if (startLine > endLine) {
      var t = startLine;
      startLine = endLine;
      endLine = t;
    }
    return { startLine: startLine, endLine: endLine };
  }

  function showButton(range, lines, selectionText) {
    if (!button) {
      button = document.createElement("a");
      button.id = BUTTON_ID;
      button.className = "markback-preview-button";
      button.textContent = "💬 Comment";
      button.setAttribute("role", "button");
      document.body.appendChild(button);
    }
    var rect = range.getBoundingClientRect();
    // Position above the selection's top-right corner. Adjust if it
    // would go off-screen (clamp to viewport).
    var top = window.scrollY + rect.top - 36;
    if (rect.top < 40) top = window.scrollY + rect.bottom + 8;
    var left = window.scrollX + rect.right - 100;
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    button.style.top = top + "px";
    button.style.left = left + "px";

    var args = [{
      sourceUri: SOURCE_URI,
      startLine: lines.startLine,
      endLine: lines.endLine,
      selectionText: truncate(selectionText, 200),
    }];
    var href = "command:markback.previewComment?" +
      encodeURIComponent(JSON.stringify(args));
    button.setAttribute("href", href);
  }

  function removeButton() {
    if (button && button.parentNode) {
      button.parentNode.removeChild(button);
    }
    button = null;
  }

  function truncate(s, n) {
    if (!s) return "";
    s = s.replace(/\s+/g, " ").trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + "…";
  }

  // The markdown extension exposes the source document as JSON-encoded
  // state on a <meta id="vscode-markdown-preview-data"> tag. The exact
  // attribute that contains the URI has shifted across versions; try
  // a few defensively.
  function resolveSourceUri() {
    var meta = document.getElementById("vscode-markdown-preview-data");
    if (meta) {
      var attrs = ["data-state", "data-settings", "data-source", "data-resource"];
      for (var i = 0; i < attrs.length; i++) {
        var raw = meta.getAttribute(attrs[i]);
        if (!raw) continue;
        var uri = extractUriFromBlob(raw);
        if (uri) return uri;
      }
    }
    var body = document.body;
    if (body) {
      var direct = body.getAttribute("data-source") || body.getAttribute("data-resource");
      if (direct) return direct;
    }
    return null;
  }

  function extractUriFromBlob(raw) {
    try {
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      // Most likely shapes: { source: "file:..." } or
      // { resource: "..." } or nested under another key.
      if (typeof obj.source === "string") return obj.source;
      if (typeof obj.resource === "string") return obj.resource;
      // Recursively scan nested objects for a "source"/"resource" string.
      for (var k in obj) {
        if (typeof obj[k] === "object" && obj[k] !== null) {
          var sub = obj[k].source || obj[k].resource;
          if (typeof sub === "string") return sub;
        }
      }
    } catch (_e) {
      // not JSON
    }
    return null;
  }
})();
