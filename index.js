function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "68", 68, "68, 79", ["68", 79], "Hex 68" -> [68, 79]
function parseHexList(value) {
  if (value === undefined || value === null || value === false) return [];
  const parts = Array.isArray(value) ? value : [value];
  const out = [];
  for (const part of parts) {
    const matches = String(part).match(/\d+/g) || [];
    for (const m of matches) {
      const n = parseInt(m, 10);
      if (n > 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

function isTrue(v) {
  return v === true || v === "true" || v === "yes" || v === 1;
}

function props(data) {
  return (data && data["dg-note-properties"]) || {};
}

function makeNameRegex(prefix) {
  return new RegExp("^\\s*" + escapeRegex(prefix || "Hex") + "[\\s_-]*0*(\\d+)\\s*$", "i");
}

function hexesForNote(fileSlug, noteProps, title, prefix) {
  const found = [];
  const re = makeNameRegex(prefix);
  for (const name of [fileSlug, title]) {
    const m = name && String(name).match(re);
    if (m) found.push(parseInt(m[1], 10));
  }
  for (const n of parseHexList(noteProps && noteProps.hex)) {
    if (!found.includes(n)) found.push(n);
  }
  return [...new Set(found)];
}

module.exports = {
  setupEleventy(eleventyConfig, context) {
    const prefix = (context.settings && context.settings.notePrefix) || "Hex";

    // Builds /hexcrawl-map.json from published notes only.
    eleventyConfig.addFilter("hexcrawlIndex", function (notes) {
      const index = { hexes: {}, reveal: [], maps: [] };
      for (const item of notes || []) {
        try {
          const data = item.data || {};
          if (data.hide) continue;
          const p = props(data);
          const title = p.title || data.title || item.fileSlug;
          if (isTrue(p.hexmap)) {
            index.maps.push({ title: String(title), url: item.url });
            for (const n of parseHexList(p["hexmap-reveal"])) {
              if (!index.reveal.includes(n)) index.reveal.push(n);
            }
            continue;
          }
          for (const n of hexesForNote(item.fileSlug, p, title, prefix)) {
            (index.hexes[n] = index.hexes[n] || []).push({ title: String(title), url: item.url });
          }
        } catch (e) {
          // one odd note must not break the index
        }
      }
      return JSON.stringify(index).replace(/</g, "\\u003c");
    });

    const indexTemplate = "{{ collections.note | hexcrawlIndex | safe }}\n";
    eleventyConfig.addTemplate("hexcrawl-map-index.njk", indexTemplate, {
      permalink: "/hexcrawl-map.json",
      eleventyExcludeFromCollections: true,
    });
  },
};
