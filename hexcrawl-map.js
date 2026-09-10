/* Hexcrawl Map — pan/zoom hex map with fog of war for Digital Garden. */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var MAX_SCALE = 8;

  function readConfig() {
    var el = document.getElementById("hexcrawl-map-config");
    var cfg = {};
    try { cfg = JSON.parse(el ? el.textContent : "{}") || {}; } catch (e) {}
    function num(v, d) { var n = Number(v); return v === "" || v === null || v === undefined || isNaN(n) ? d : n; }
    return {
      revealNeighbours: cfg.revealNeighbours !== false && cfg.revealNeighbours !== "false",
      showNumbers: cfg.showNumbers || "explored",
      fogColour: cfg.fogColour || "#1c1914",
      fogOpacity: Math.min(1, Math.max(0, num(cfg.fogOpacity, 0.97))),
      neighbourFog: Math.min(1, Math.max(0, num(cfg.neighbourFog, 0.9))),
      fogCoverage: ["map", "grid", "image"].indexOf(cfg.fogCoverage) >= 0 ? cfg.fogCoverage : "map",
      fogRadius: num(cfg.fogRadius, 0.468),
      panel: cfg.clickShows !== "links",
      mapHeight: cfg.mapHeight || "80vh",
      orientation: cfg.gridOrientation === "pointy" ? "pointy" : "flat",
      size: num(cfg.gridSize, 0.025),
      originX: num(cfg.gridOriginX, 0.07475),
      originY: num(cfg.gridOriginY, 0.0000225),
      clipRadius: num(cfg.gridClipRadius, 0.4497)
    };
  }

  // Hex centres in image-width units (x in 0..1, y in 0..aspect), numbered
  // in reading order: top to bottom, then left to right.
  function buildGrid(cfg, aspect) {
    var s = cfg.size, hexes = [];
    if (!(s > 0)) return hexes;
    var flat = cfg.orientation === "flat";
    var colStep = flat ? 1.5 * s : Math.sqrt(3) * s;
    var rowStep = flat ? Math.sqrt(3) * s : 1.5 * s;
    var iMin = Math.floor(-cfg.originX / colStep) - 1, iMax = Math.ceil((1 - cfg.originX) / colStep) + 1;
    var jMin = Math.floor(-cfg.originY / rowStep) - 2, jMax = Math.ceil((aspect - cfg.originY) / rowStep) + 2;
    for (var i = iMin; i <= iMax; i++) {
      for (var j = jMin; j <= jMax; j++) {
        var x, y;
        if (flat) {
          x = cfg.originX + i * colStep;
          y = cfg.originY + j * rowStep + (((i % 2) + 2) % 2 ? rowStep / 2 : 0);
        } else {
          y = cfg.originY + j * rowStep;
          x = cfg.originX + i * colStep + (((j % 2) + 2) % 2 ? colStep / 2 : 0);
        }
        if (x < 0 || x > 1 || y < 0 || y > aspect) continue;
        if (cfg.clipRadius > 0 && Math.hypot(x - 0.5, y - aspect / 2) >= cfg.clipRadius) continue;
        hexes.push({ x: x, y: y });
      }
    }
    hexes.sort(function (a, b) {
      var dy = Math.round(a.y * 1e6) - Math.round(b.y * 1e6);
      return dy !== 0 ? dy : a.x - b.x;
    });
    hexes.forEach(function (h, k) { h.n = k + 1; });
    return hexes;
  }

  function corners(h, r, flat) {
    var pts = [];
    for (var k = 0; k < 6; k++) {
      var a = Math.PI / 180 * (60 * k + (flat ? 0 : 30));
      pts.push([h.x + r * Math.cos(a), h.y + r * Math.sin(a)]);
    }
    return pts;
  }

  function el(tag, attrs, parent) {
    var node = tag.indexOf("svg:") === 0 ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function findMapImage() {
    var main = document.querySelector("main.content") || document.querySelector(".content") || document.body;
    var imgs = main.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].closest(".hexcrawl-map, .callout-icon, nav, header")) return imgs[i];
    }
    return null;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function drawFog(canvas, hexes, state, cfg, aspect) {
    var cw = canvas.width, ch = canvas.height, flat = cfg.orientation === "flat";
    var blur = Math.max(1, cfg.size * cw * 0.18);
    // pad the working canvas so the blur doesn't fade the fog at the image edge
    var pad = Math.ceil(blur * 3);
    var work = document.createElement("canvas");
    work.width = cw + 2 * pad; work.height = ch + 2 * pad;
    var ctx = work.getContext("2d");
    ctx.translate(pad, pad);

    function pathFor(list, grow) {
      ctx.beginPath();
      list.forEach(function (h) {
        var pts = corners(h, cfg.size * grow, flat);
        ctx.moveTo(pts[0][0] * cw, pts[0][1] * cw);
        for (var k = 1; k < 6; k++) ctx.lineTo(pts[k][0] * cw, pts[k][1] * cw);
        ctx.closePath();
      });
    }

    // 1. fog over the map area and every hex (single paths so overlaps don't stack)
    ctx.fillStyle = cfg.fogColour;
    var circular = cfg.clipRadius > 0 && cfg.fogRadius > 0;
    if (cfg.fogCoverage === "image" || (cfg.fogCoverage === "map" && !circular)) {
      ctx.fillRect(-pad, -pad, cw + 2 * pad, ch + 2 * pad);
    } else if (cfg.fogCoverage === "map") {
      ctx.beginPath();
      ctx.arc(0.5 * cw, (aspect / 2) * cw, cfg.fogRadius * cw, 0, Math.PI * 2);
      ctx.fill();
    }
    pathFor(hexes, 1.03);
    ctx.fill();

    // 2. cloudy variation, only where fog already is
    var noise = document.createElement("canvas");
    noise.width = 48; noise.height = Math.max(1, Math.round(48 * aspect));
    var nctx = noise.getContext("2d");
    var seed = 1337;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var y = 0; y < noise.height; y++) {
      for (var x = 0; x < noise.width; x++) {
        var v = Math.floor(rand() * 255);
        nctx.fillStyle = "rgba(" + v + "," + v + "," + v + "," + (rand() * 0.35).toFixed(3) + ")";
        nctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalCompositeOperation = "source-atop";
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(noise, -pad, -pad, cw + 2 * pad, ch + 2 * pad);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(noise, 0, 0, noise.width / 3, noise.height / 3, -pad, -pad, cw + 2 * pad, ch + 2 * pad);
    ctx.globalAlpha = 1;

    // 3. clear explored hexes, thin the fog on their neighbours
    ctx.globalCompositeOperation = "destination-out";
    var seen = hexes.filter(function (h) { return state[h.n] === "seen"; });
    if (seen.length && cfg.neighbourFog < 1) {
      ctx.globalAlpha = 1 - cfg.neighbourFog;
      pathFor(seen, 1.01);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    var explored = hexes.filter(function (h) { return state[h.n] === "explored"; });
    if (explored.length) {
      pathFor(explored, 1.04);
      ctx.fill();
    }

    // 4. soften the edges
    var out = canvas.getContext("2d");
    out.clearRect(0, 0, cw, ch);
    if ("filter" in out) out.filter = "blur(" + blur.toFixed(1) + "px)";
    out.drawImage(work, -pad, -pad);
    if ("filter" in out) out.filter = "none";
  }

  function init() {
    var cfg = readConfig();
    var sourceImg = findMapImage();
    if (!sourceImg) { console.warn("[hexcrawl-map] no image found in this note"); return; }
    var picture = sourceImg.closest("picture");
    var src = sourceImg.getAttribute("src") || sourceImg.currentSrc;
    var anchor = picture || sourceImg;

    Promise.all([
      loadImage(src),
      fetch("/hexcrawl-map.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
    ]).then(function (res) {
      build(cfg, anchor, res[0], res[1] || {});
    }).catch(function (e) {
      console.warn("[hexcrawl-map] could not load map image", e);
    });
  }

  function build(cfg, anchor, img, index) {
    var aspect = img.naturalHeight / img.naturalWidth;
    var hexes = buildGrid(cfg, aspect);
    var byNum = {};
    hexes.forEach(function (h) { byNum[h.n] = h; });
    var flat = cfg.orientation === "flat";
    var notes = index.hexes || {};

    // explored / seen state
    var state = {};
    Object.keys(notes).forEach(function (n) { if (byNum[n]) state[n] = "explored"; });
    (index.reveal || []).forEach(function (n) { if (byNum[n]) state[n] = "explored"; });
    if (cfg.revealNeighbours) {
      var nbDist = Math.sqrt(3) * cfg.size * 1.1;
      hexes.forEach(function (h) {
        if (state[h.n] !== "explored") return;
        hexes.forEach(function (o) {
          if (!state[o.n] && Math.hypot(o.x - h.x, o.y - h.y) < nbDist) state[o.n] = "seen";
        });
      });
    }
    var exploredCount = hexes.filter(function (h) { return state[h.n] === "explored"; }).length;

    // DOM
    var root = el("div", { class: "hexcrawl-map" });
    root.style.setProperty("--hexcrawl-height", cfg.mapHeight);
    var viewport = el("div", { class: "hexcrawl-viewport", tabindex: "0", "aria-label": "Hex map. Drag to pan, scroll or pinch to zoom." }, root);
    var stage = el("div", { class: "hexcrawl-stage" }, viewport);
    var mapImg = el("img", { class: "hexcrawl-image", src: img.src, alt: anchor.getAttribute && (anchor.getAttribute("alt") || "Map"), draggable: "false" }, stage);

    var fog = el("canvas", { class: "hexcrawl-fog", "aria-hidden": "true" }, stage);
    fog.width = Math.min(img.naturalWidth, 2048);
    fog.height = Math.round(fog.width * aspect);
    fog.style.opacity = cfg.fogOpacity;
    drawFog(fog, hexes, state, cfg, aspect);

    var svg = el("svg:svg", { class: "hexcrawl-grid", viewBox: "0 0 1 " + aspect, preserveAspectRatio: "none" }, stage);
    var highlight = null;
    var polys = {};
    hexes.forEach(function (h) {
      var pts = corners(h, cfg.size, flat).map(function (p) { return p[0].toFixed(5) + "," + p[1].toFixed(5); }).join(" ");
      var cls = "hexcrawl-hex is-" + (state[h.n] === "explored" ? "explored" : "fogged");
      polys[h.n] = el("svg:polygon", { points: pts, class: cls, "data-hex": h.n }, svg);
    });
    var labels = el("svg:g", { class: "hexcrawl-labels", "aria-hidden": "true" }, svg);
    var labelNodes = [];
    hexes.forEach(function (h) {
      var show = cfg.showNumbers === "all" || (cfg.showNumbers === "explored" && state[h.n] === "explored");
      if (!show) return;
      var t = el("svg:text", { x: h.x.toFixed(5), y: (h.y - cfg.size * 0.45).toFixed(5), text: String(h.n) }, labels);
      t._hy = h.y;
      labelNodes.push(t);
    });

    var controls = el("div", { class: "hexcrawl-controls" }, root);
    var btnIn = el("button", { type: "button", "aria-label": "Zoom in", title: "Zoom in", text: "+" }, controls);
    var btnOut = el("button", { type: "button", "aria-label": "Zoom out", title: "Zoom out", text: "−" }, controls);
    var btnReset = el("button", { type: "button", "aria-label": "Reset view", title: "Reset view", text: "⟲" }, controls);
    var btnMax = el("button", { type: "button", "aria-label": "Expand map", title: "Expand map", text: "⤢" }, controls);
    el("div", { class: "hexcrawl-status", text: exploredCount + " / " + hexes.length + " hexes explored" }, root);
    var popup = el("div", { class: "hexcrawl-popup", role: "dialog", hidden: "" }, root);
    var panel = el("aside", { class: "hexcrawl-panel", hidden: "", "aria-live": "polite" }, root);
    var panelHead = el("div", { class: "hexcrawl-panel-head" }, panel);
    var panelTitle = el("div", { class: "hexcrawl-panel-title" }, panelHead);
    var panelClose = el("button", { type: "button", class: "hexcrawl-panel-close", "aria-label": "Close", title: "Close", text: "✕" }, panelHead);
    var panelBody = el("div", { class: "hexcrawl-panel-body" }, panel);

    // note URL -> hex number, so links between hex notes stay on the map
    var urlToHex = {};
    Object.keys(notes).forEach(function (n) {
      notes[n].forEach(function (note) { if (!(note.url in urlToHex)) urlToHex[note.url] = parseInt(n, 10); });
    });

    anchor.parentNode.insertBefore(root, anchor);
    anchor.remove();

    // ---- pan / zoom -------------------------------------------------------
    var view = { s: 1, tx: 0, ty: 0 }, base = { w: 0, h: 0 };

    function layout() {
      viewport.style.height = root.classList.contains("is-maximised")
        ? ""
        : "min(" + cfg.mapHeight + ", " + Math.round(root.clientWidth * aspect) + "px)";
      root.classList.toggle("is-narrow", root.clientWidth < 620);
      var vw = viewport.clientWidth, vh = viewport.clientHeight;
      var w = Math.min(vw, vh / aspect);
      base.w = w; base.h = w * aspect;
      stage.style.width = base.w + "px";
      stage.style.height = base.h + "px";
    }
    function clamp() {
      var vw = viewport.clientWidth, vh = viewport.clientHeight;
      var w = base.w * view.s, h = base.h * view.s;
      view.tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, view.tx));
      view.ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, view.ty));
    }
    function apply() {
      clamp();
      stage.style.transform = "translate(" + view.tx + "px," + view.ty + "px) scale(" + view.s + ")";
      root.style.setProperty("--hexcrawl-scale", view.s);
      // keep hex numbers a readable, constant size on screen
      var px = base.w * view.s;
      if (px > 0) {
        var fs = Math.min(cfg.size * 0.5, 13 / px);
        labels.setAttribute("font-size", fs.toFixed(6));
        labelNodes.forEach(function (t) { t.setAttribute("y", (t._hy - Math.min(cfg.size * 0.45, fs * 1.1)).toFixed(6)); });
      }
    }
    function zoomAt(factor, cx, cy) {
      var ns = Math.min(MAX_SCALE, Math.max(1, view.s * factor));
      var k = ns / view.s;
      view.tx = cx - (cx - view.tx) * k;
      view.ty = cy - (cy - view.ty) * k;
      view.s = ns;
      apply();
    }
    function reset() { view.s = 1; view.tx = 0; view.ty = 0; apply(); }
    function centreOn(h, scale) {
      view.s = scale;
      view.tx = viewport.clientWidth / 2 - h.x * base.w * scale;
      view.ty = viewport.clientHeight / 2 - h.y * base.w * scale;
      apply();
    }
    function local(e) {
      var r = viewport.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    viewport.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = local(e);
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p.x, p.y);
    }, { passive: false });

    var pointers = {}, drag = null, pinch = null, moved = false;
    viewport.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers[e.pointerId] = local(e);
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        drag = { x: pointers[ids[0]].x, y: pointers[ids[0]].y, tx: view.tx, ty: view.ty };
        moved = false;
      } else if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
        drag = null; moved = true;
      }
    });
    viewport.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = local(e);
      var ids = Object.keys(pointers);
      if (pinch && ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((pinch.s * d / pinch.d) / view.s, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (drag) {
        var p = pointers[e.pointerId];
        if (!moved && Math.hypot(p.x - drag.x, p.y - drag.y) > 5) {
          moved = true;
          viewport.setPointerCapture(e.pointerId);
          viewport.classList.add("is-dragging");
        }
        if (moved) {
          view.tx = drag.tx + p.x - drag.x;
          view.ty = drag.ty + p.y - drag.y;
          apply();
        }
      }
    });
    function endPointer(e) {
      if (!pointers[e.pointerId]) return;
      var wasTap = drag && !moved && e.type === "pointerup";
      var p = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!Object.keys(pointers).length) { drag = null; viewport.classList.remove("is-dragging"); }
      if (wasTap) handleTap(e, p);
    }
    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);
    viewport.addEventListener("dblclick", function (e) { var p = local(e); zoomAt(2, p.x, p.y); });
    // keep other plugins (e.g. image lightbox) from reacting to map clicks
    viewport.addEventListener("click", function (e) { e.stopPropagation(); });

    viewport.addEventListener("keydown", function (e) {
      var cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2, step = 60;
      if (e.key === "+" || e.key === "=") zoomAt(1.4, cx, cy);
      else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.4, cx, cy);
      else if (e.key === "ArrowLeft") { view.tx += step; apply(); }
      else if (e.key === "ArrowRight") { view.tx -= step; apply(); }
      else if (e.key === "ArrowUp") { view.ty += step; apply(); }
      else if (e.key === "ArrowDown") { view.ty -= step; apply(); }
      else if (e.key === "Escape") {
        if (!popup.hidden || !panel.hidden) closeAll();
        else if (root.classList.contains("is-maximised")) toggleMax();
      }
      else return;
      e.preventDefault();
    });

    btnIn.addEventListener("click", function () { zoomAt(1.5, viewport.clientWidth / 2, viewport.clientHeight / 2); });
    btnOut.addEventListener("click", function () { zoomAt(1 / 1.5, viewport.clientWidth / 2, viewport.clientHeight / 2); });
    btnReset.addEventListener("click", function () { closeAll(); reset(); });
    function toggleMax() {
      var cx = (viewport.clientWidth / 2 - view.tx) / (base.w * view.s);
      var cy = (viewport.clientHeight / 2 - view.ty) / (base.w * view.s);
      root.classList.toggle("is-maximised");
      document.documentElement.classList.toggle("hexcrawl-noscroll", root.classList.contains("is-maximised"));
      btnMax.textContent = root.classList.contains("is-maximised") ? "✕" : "⤢";
      layout();
      centreOn({ x: cx, y: cy }, view.s);
    }
    btnMax.addEventListener("click", toggleMax);

    // ---- hex lookup + popup ----------------------------------------------
    function hexAt(p) {
      var x = (p.x - view.tx) / (base.w * view.s), y = (p.y - view.ty) / (base.w * view.s);
      var best = null, bestD = Infinity;
      hexes.forEach(function (h) {
        var d = Math.hypot(h.x - x, h.y - y);
        if (d < bestD) { bestD = d; best = h; }
      });
      return best && bestD <= cfg.size ? best : null;
    }
    function select(h) {
      if (highlight) highlight.classList.remove("is-selected");
      highlight = h ? polys[h.n] : null;
      if (highlight) highlight.classList.add("is-selected");
    }
    function closePopup() { popup.hidden = true; }
    function closePanel() { panel.hidden = true; root.classList.remove("has-panel"); }
    function closeAll() { closePopup(); closePanel(); select(null); }

    function noteLabel(note, n) {
      return /^\D*\d+\s*$/.test(note.title) && note.title.match(/\d+/)[0].replace(/^0+/, "") === String(n)
        ? "Hex notes" : note.title;
    }

    function openPopup(h, p) {
      closePanel();
      select(h);
      popup.textContent = "";
      el("div", { class: "hexcrawl-popup-title", text: "Hex " + h.n }, popup);
      var list = notes[h.n] || [];
      if (list.length) {
        var ul = el("ul", {}, popup);
        list.forEach(function (note) {
          el("a", { href: note.url, class: "internal-link", text: noteLabel(note, h.n) }, el("li", {}, ul));
        });
      } else {
        el("div", { class: "hexcrawl-popup-sub", text: state[h.n] === "explored" ? "Explored" : "Unexplored" }, popup);
      }
      popup.hidden = false;
      var pw = popup.offsetWidth, ph = popup.offsetHeight;
      var left = Math.min(Math.max(8, p.x + 12), viewport.clientWidth - pw - 8);
      var top = p.y + 12 + ph > viewport.clientHeight ? p.y - ph - 12 : p.y + 12;
      popup.style.left = left + "px";
      popup.style.top = Math.max(8, top) + "px";
    }

    // Fetch a published note and keep just its body.
    var pageCache = {};
    function fetchNote(url) {
      if (!pageCache[url]) {
        pageCache[url] = fetch(url)
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
          .then(function (html) {
            var doc = new DOMParser().parseFromString(html, "text/html");
            var main = doc.querySelector("main.content") || doc.querySelector(".content");
            if (!main) throw new Error("no content");
            main.querySelectorAll("header, script, style, noscript, template, .hexcrawl-backlinks, .hexcrawl-map, [class^='gp-'], [class*=' gp-']")
              .forEach(function (node) { node.remove(); });
            return main.innerHTML;
          })
          .catch(function (err) { delete pageCache[url]; throw err; });
      }
      return pageCache[url];
    }

    function openPanel(h) {
      closePopup();
      select(h);
      var list = notes[h.n] || [];
      panelTitle.textContent = "Hex " + h.n;
      panelBody.textContent = "";
      panelBody.scrollTop = 0;
      list.forEach(function (note) {
        var section = el("section", { class: "hexcrawl-note" }, panelBody);
        var head = el("div", { class: "hexcrawl-note-head" }, section);
        el("h3", { text: noteLabel(note, h.n) }, head);
        el("a", { href: note.url, class: "hexcrawl-note-open", title: "Open the full page", text: "Open page ↗" }, head);
        var body = el("div", { class: "hexcrawl-note-body", text: "Loading…" }, section);
        fetchNote(note.url).then(function (html) {
          body.innerHTML = html;
          // drop a leading heading that just repeats the note title
          var first = body.firstElementChild;
          while (first && first.matches("h1, h2") && first.textContent.trim().toLowerCase() === note.title.trim().toLowerCase()) {
            var next = first.nextElementSibling; first.remove(); first = next;
          }
          if (!body.textContent.trim() && !body.querySelector("img")) body.textContent = "Nothing written here yet.";
        }).catch(function () {
          body.textContent = "Couldn't load this note. ";
          el("a", { href: note.url, text: "Open it" }, body);
        });
      });
      panel.hidden = false;
      root.classList.add("has-panel");
      keepVisible(h);
    }

    // nudge the map so the selected hex isn't hidden behind the panel
    function keepVisible(h) {
      var sx = view.tx + h.x * base.w * view.s, sy = view.ty + h.y * base.w * view.s;
      var margin = cfg.size * base.w * view.s + 16;
      if (root.classList.contains("is-narrow")) {
        if (!root.classList.contains("is-maximised")) return;
        var limitY = viewport.clientHeight - panel.offsetHeight - margin;
        if (sy > limitY) { view.ty -= sy - limitY; apply(); }
      } else {
        var limitX = viewport.clientWidth - panel.offsetWidth - margin;
        if (sx > limitX) { view.tx -= sx - limitX; apply(); }
      }
    }

    // links to other hex notes inside the panel move the map instead of leaving the page
    panelBody.addEventListener("click", function (e) {
      var a = e.target.closest("a[href]");
      if (!a || a.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var url;
      try { url = new URL(a.getAttribute("href"), location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      var n = urlToHex[url.pathname] || urlToHex[decodeURI(url.pathname)];
      if (!n || !byNum[n]) return;
      e.preventDefault();
      goTo(byNum[n]);
    });
    panelClose.addEventListener("click", closeAll);

    function goTo(h) {
      if (!h || state[h.n] !== "explored") return;
      if (view.s < 2) centreOn(h, 3);
      if (cfg.panel && (notes[h.n] || []).length) openPanel(h);
      else openPopup(h, { x: view.tx + h.x * base.w * view.s, y: view.ty + h.y * base.w * view.s });
      if (window.history && history.replaceState) {
        var u = new URL(location.href); u.searchParams.set("hex", h.n); history.replaceState(null, "", u);
      }
    }

    function handleTap(e, p) {
      var h = hexAt(p);
      // only explored hexes can be selected; fog gives nothing away
      if (!h || state[h.n] !== "explored") { closeAll(); return; }
      if (cfg.panel && (notes[h.n] || []).length) openPanel(h);
      else openPopup(h, p);
    }

    // ---- start -----------------------------------------------------------
    layout();
    reset();
    window.addEventListener("resize", function () { layout(); apply(); });

    var params = new URLSearchParams(location.search);
    var target = byNum[parseInt(params.get("hex"), 10)];
    if (target && state[target.n] === "explored") {
      centreOn(target, 3);
      goTo(target);
      root.scrollIntoView({ block: "center" });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
