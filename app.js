/* Image to Base64 — encode with btoa over the file's bytes, decode with atob. All local. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var SHOW = 100000; // longest text shown in a box; Copy always copies everything

  // ---------- pure helpers ----------
  function bytesToB64(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var t = String(b64).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t) || t.length % 4 === 1) throw new Error("Not valid Base64");
    while (t.length % 4) t += "=";
    var bin = atob(t), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function sniff(u8) {
    function at(off, str) { for (var i = 0; i < str.length; i++) if (u8[off + i] !== str.charCodeAt(i)) return false; return true; }
    if (u8[0] === 0x89 && at(1, "PNG")) return "image/png";
    if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return "image/jpeg";
    if (at(0, "GIF8")) return "image/gif";
    if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
    if (at(4, "ftypavif") || at(4, "ftypavis")) return "image/avif";
    if (at(4, "ftypheic") || at(4, "ftypheix") || at(4, "ftypmif1")) return "image/heic";
    if (at(0, "BM")) return "image/bmp";
    if (u8[0] === 0 && u8[1] === 0 && u8[2] === 1 && u8[3] === 0) return "image/x-icon";
    if (at(0, "II*\0") || at(0, "MM\0*")) return "image/tiff";
    if (at(0, "%PDF")) return "application/pdf";
    var head = new TextDecoder().decode(u8.subarray(0, 1024)).replace(/^﻿/, "").trim();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
    return "application/octet-stream";
  }
  // Accepts a bare data URI, CSS url("…"), <img src="…">, or raw Base64.
  function parseInput(text) {
    text = String(text).trim();
    if (!text) return null;
    var m = /data:([\w.+-]+\/[\w.+-]+)?((?:;[\w.+-]+(?:=[\w.+-]+)?)*),([^"')]*)/i.exec(text);
    if (m) {
      var isB64 = /;base64/i.test(m[2]), mime = (m[1] || "text/plain").toLowerCase(), bytes;
      if (isB64) bytes = b64ToBytes(m[3]);
      else {
        var raw;
        try { raw = decodeURIComponent(m[3]); } catch (e) { throw new Error("The URL-encoded data is broken"); }
        bytes = new TextEncoder().encode(raw);
      }
      return { mime: mime, declared: true, bytes: bytes };
    }
    var u8 = b64ToBytes(text);
    if (!u8.length) throw new Error("Not valid Base64");
    return { mime: sniff(u8), declared: false, bytes: u8 };
  }
  // SVG is text, so a URL-encoded data URI is usually ~30% smaller than Base64.
  function svgDataUri(svg) {
    return "data:image/svg+xml," + svg.trim().replace(/\s*[\r\n]+\s*/g, " ").replace(/[%#<>"{}|\\^`]/g, encodeURIComponent).replace(/[^\x20-\x7E]/gu, encodeURIComponent);
  }
  var EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/heic": "heic",
    "image/bmp": "bmp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/tiff": "tif", "image/svg+xml": "svg", "application/pdf": "pdf", "text/plain": "txt" };
  function stat(l, v) { return '<div class="stat"><b>' + S3.esc(v) + "</b><span>" + S3.esc(l) + "</span></div>"; }

  // ---------- mode ----------
  $$("#mode button").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("#mode button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      $("#enc").hidden = b.dataset.v !== "enc"; $("#dec").hidden = b.dataset.v !== "dec";
      S3.store("b64.mode", b.dataset.v);
    });
  });
  if (S3.store("b64.mode") === "dec") $("#mode button[data-v=dec]").click();

  // ---------- encode ----------
  var encUrl = null;
  function snippet(title, text, note) {
    var ta = S3.h("textarea", { "class": "textarea b64-out", readonly: true, spellcheck: "false", "aria-label": title });
    ta.value = text.length > SHOW ? text.slice(0, SHOW) + "\n… (" + (text.length - SHOW).toLocaleString() + " more characters, Copy gets everything)" : text;
    var btn = S3.h("button", { "class": "btn small", html: '<svg class="i"><use href="#i-copy"/></svg>Copy' });
    btn.addEventListener("click", function () { S3.copy(text, title + " copied"); S3.done(); });
    return S3.h("div", { "class": "b64-snip" }, [
      S3.h("div", { "class": "row between" }, [S3.h("h2", { text: title }), S3.h("span", { "class": "row" }, [note ? S3.h("span", { "class": "faint", text: note }) : null, btn])]),
      ta
    ]);
  }
  function encode(file) {
    file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), mime = file.type || sniff(u8);
      if (mime === "application/octet-stream") mime = sniff(u8);
      var b64 = bytesToB64(u8), uri = "data:" + mime + ";base64," + b64, name = file.name || "image";
      if (encUrl) URL.revokeObjectURL(encUrl);
      encUrl = URL.createObjectURL(new Blob([u8], { type: mime }));
      var img = $("#encImg");
      img.onload = function () { render(img.naturalWidth, img.naturalHeight); };
      img.onerror = function () { render(0, 0); };
      img.src = encUrl;
      function render(w, h) {
        $("#drop").classList.add("b64-small");
        $("#encInfo").hidden = false; $("#encName").textContent = name;
        var warn = $("#encWarn");
        if (uri.length > 1048576) { warn.className = "chip bad"; warn.textContent = "Very large: use a normal file"; }
        else if (uri.length > 10240) { warn.className = "chip warn"; warn.textContent = "Over 10 KB: inlining may slow pages"; }
        else { warn.className = "chip ok"; warn.textContent = "Small enough to inline"; }
        $("#encStats").innerHTML = stat("type", mime.replace("image/", "").toUpperCase()) + (w ? stat("dimensions", w + " × " + h) : "") +
          stat("file size", S3.fmtBytes(u8.length)) + stat("as Base64", S3.fmtBytes(uri.length) + " (+" + Math.round((uri.length / Math.max(1, u8.length) - 1) * 100) + "%)");
        var alt = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        var box = $("#snips"); box.innerHTML = "";
        box.appendChild(snippet("Data URI", uri));
        box.appendChild(snippet("Base64 only", b64));
        box.appendChild(snippet("CSS", "background-image: url(\"" + uri + "\");"));
        box.appendChild(snippet("HTML", "<img src=\"" + uri + "\"" + (w ? " width=\"" + w + "\" height=\"" + h + "\"" : "") + " alt=\"" + S3.esc(alt) + "\">"));
        box.appendChild(snippet("Markdown", "![" + alt.replace(/[[\]]/g, "") + "](" + uri + ")"));
        if (mime === "image/svg+xml") {
          var svgUri = svgDataUri(new TextDecoder().decode(u8));
          box.appendChild(snippet("SVG as URL-encoded data URI", svgUri, S3.fmtBytes(svgUri.length) + ", " + Math.round(100 - svgUri.length / uri.length * 100) + "% smaller"));
        }
        var dl = S3.h("button", { "class": "btn ghost small", html: '<svg class="i"><use href="#i-download"/></svg>Save data URI as .txt' });
        dl.addEventListener("click", function () { S3.download(uri, alt.replace(/\s+/g, "-") + ".base64.txt", "text/plain"); S3.done(); });
        box.appendChild(S3.h("div", { "class": "row end" }, [dl]));
      }
    }, function () { S3.toast("Couldn't read that file", "error"); });
  }
  S3.drop($("#drop"), function (fs) { encode(fs[0]); }, { accept: "image/*,.svg,.ico", multiple: false });
  document.addEventListener("paste", function (e) {
    if ($("#enc").hidden) return;
    var f = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []).filter(function (x) { return /^image\//.test(x.type); })[0];
    if (f) { e.preventDefault(); encode(f); }
  });

  // ---------- decode ----------
  var dec = null, decUrl = null, decIn = $("#decIn");
  function setStatus(cls, text) { var s = $("#decStatus"); s.className = "chip " + cls; s.textContent = text; }
  function decode() {
    var img = $("#decImg");
    dec = null; $("#decDl").disabled = true; $("#decStats").innerHTML = ""; img.hidden = true; $("#decNoPrev").hidden = false;
    if (decUrl) { URL.revokeObjectURL(decUrl); decUrl = null; }
    var r;
    try { r = parseInput(decIn.value); } catch (e) { setStatus("bad", e.message); return; }
    if (!r) { setStatus("", "Waiting for input"); return; }
    var sniffed = sniff(r.bytes), mime = r.mime;
    if (!r.declared || mime === "application/octet-stream") mime = sniffed;
    dec = { bytes: r.bytes, mime: mime };
    $("#decDl").disabled = false;
    var mismatch = r.declared && sniffed !== "application/octet-stream" && sniffed !== mime && !(sniffed === "image/x-icon" && /icon/.test(mime));
    var stats = stat("type", mime) + stat("size", S3.fmtBytes(r.bytes.length));
    $("#decStats").innerHTML = stats;
    if (/^image\//.test(mime)) {
      decUrl = URL.createObjectURL(new Blob([r.bytes], { type: mime }));
      img.onload = function () {
        img.hidden = false; $("#decNoPrev").hidden = true;
        $("#decStats").innerHTML = stats + stat("dimensions", img.naturalWidth + " × " + img.naturalHeight);
        setStatus(mismatch ? "warn" : "ok", mismatch ? "Decoded, but the bytes look like " + sniffed : "Valid image");
      };
      img.onerror = function () { setStatus("warn", "Decoded " + S3.fmtBytes(r.bytes.length) + ", but your browser can't display it"); };
      img.src = decUrl;
    } else {
      setStatus("warn", "Decoded, but it's not an image (" + mime + ")");
    }
  }
  decIn.addEventListener("input", S3.debounce(decode, 200));
  $("#decClear").addEventListener("click", function () { decIn.value = ""; decode(); decIn.focus(); });
  $("#decDl").addEventListener("click", function () {
    if (!dec) return;
    S3.download(new Blob([dec.bytes], { type: dec.mime }), "decoded." + (EXT[dec.mime] || "bin"));
    S3.done();
  });

  // ---------- demo + selftest ----------
  function sampleFile() {
    var c = document.createElement("canvas"); c.width = 64; c.height = 64;
    var x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, "#3dd6d0"); g.addColorStop(1, "#3b5bdb");
    x.fillStyle = g; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill();
    x.fillStyle = "#fff"; x.font = "700 30px Inter, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("S3", 32, 34);
    return new Promise(function (res) { c.toBlob(function (b) { res(new File([b], "logo.png", { type: "image/png" })); }, "image/png"); });
  }
  window.S3_DEMO = function () { return sampleFile().then(encode).then(function () { return new Promise(function (r) { setTimeout(r, 200); }); }); };

  var PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  window.S3_SELFTEST = function () {
    var enc = new TextEncoder(), dec8 = new TextDecoder();
    function bad(s) { try { parseInput(s); return false; } catch (e) { return true; } }
    var ok = bytesToB64(enc.encode("Man")) === "TWFu" && bytesToB64(enc.encode("Ma")) === "TWE=" && bytesToB64(new Uint8Array(0)) === "" &&
      dec8.decode(b64ToBytes("TWFu")) === "Man" && dec8.decode(b64ToBytes("TWE")) === "Ma" &&
      bytesToB64(b64ToBytes("-_8")) === "+/8=" && bytesToB64(new Uint8Array([0xfb, 0xff])) === "+/8=" &&
      bad("abc$") && bad("A") && bad("data:image/png;base64,***");
    var css = parseInput('background: url("data:image/png;base64,' + PNG1 + '");');
    var tag = parseInput('<img src="data:image/png;base64,' + PNG1 + '" alt="">');
    var raw = parseInput(PNG1.replace(/(.{20})/g, "$1\n"));
    var svgp = parseInput("data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%2F%3E");
    ok = ok && css.mime === "image/png" && css.bytes.length === 70 && tag.bytes.length === 70 && raw.mime === "image/png" && !raw.declared &&
      dec8.decode(svgp.bytes).indexOf("<svg") === 0 && sniff(svgp.bytes) === "image/svg+xml" &&
      sniff(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])) === "image/jpeg" && sniff(enc.encode("GIF89a")) === "image/gif" &&
      sniff(enc.encode('<?xml version="1.0"?>\n<svg xmlns="x"/>')) === "image/svg+xml" && sniff(enc.encode("hello")) === "application/octet-stream" &&
      svgDataUri('<svg a="1">\n  #é</svg>') === "data:image/svg+xml,%3Csvg a=%221%22%3E %23%C3%A9%3C/svg%3E";
    if (!ok) return false;
    // the decoded 1×1 PNG must really load as an image
    return new Promise(function (res) {
      var u = URL.createObjectURL(new Blob([raw.bytes], { type: "image/png" })), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im.naturalWidth === 1 && im.naturalHeight === 1); };
      im.onerror = function () { res("1x1 PNG did not load"); };
      im.src = u;
    });
  };
})();
