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

function lower(v) {
  return typeof v === "string" || typeof v === "number" ? String(v).trim().toLowerCase() : "";
}

// "[[Places/Ledge Camp|Camp]]" -> "Ledge Camp"; a plain name as typed.
// Something that starts like a wikilink but isn't one ("[[Ledge Camp",
// "[[Ledge Camp]] east") is no place at all, rather than a guess.
function placeName(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw.startsWith("[[") && !raw.startsWith("![[")) return raw;
  const link = raw.match(/^!?\[\[([^\[\]]+)\]\]$/);
  if (!link) return "";
  const target = link[1].split("|")[0].split("#")[0].trim();
  return target ? target.split("/").pop().trim() : "";
}

// A character's location as a hex number: 57, "57" or "Hex 57" is that hex;
// a place name is the hex of the published note with that title; anything
// else is no hex. Never reveals anything: the caller only keeps hexes that
// are already explored.
function locationHex(value, places, prefix) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  const name = placeName(value);
  if (!name) return null;
  const m = name.match(/^\d+$/) ? [name, name] : name.match(makeNameRegex(prefix));
  if (m) {
    const n = parseInt(m[1], 10);
    return n > 0 ? n : null;
  }
  const hexes = places.get(name.toLowerCase());
  return hexes && hexes.length ? hexes[0] : null;
}

module.exports = {
  setupEleventy(eleventyConfig, context) {
    const prefix = (context.settings && context.settings.notePrefix) || "Hex";

    // Builds /hexcrawl-map.json from published notes only.
    eleventyConfig.addFilter("hexcrawlIndex", function (notes) {
      const index = { hexes: {}, reveal: [], maps: [], characters: {} };
      const places = new Map(); // lower-cased note title or file name -> its hexes
      const people = []; // characters with a location, resolved once every note is read
      for (const item of notes || []) {
        try {
          const data = item.data || {};
          if (data.hide) continue;
          const p = props(data);
          const title = p.title || data.title || item.fileSlug;
          if (lower(p.type) === "character" && p.location !== undefined && p.location !== null) {
            people.push({ name: String(title), location: p.location });
          }
          if (isTrue(p.hexmap)) {
            index.maps.push({ title: String(title), url: item.url });
            for (const n of parseHexList(p["hexmap-reveal"])) {
              if (!index.reveal.includes(n)) index.reveal.push(n);
            }
            continue;
          }
          const noteHexes = hexesForNote(item.fileSlug, p, title, prefix);
          for (const n of noteHexes) {
            (index.hexes[n] = index.hexes[n] || []).push({ title: String(title), url: item.url });
          }
          if (noteHexes.length) {
            for (const key of [lower(title), lower(item.fileSlug)]) {
              if (key && !places.has(key)) places.set(key, noteHexes);
            }
          }
        } catch (e) {
          // one odd note must not break the index
        }
      }

      // Who is where, on explored hexes only: a location never lifts the fog.
      const explored = new Set(Object.keys(index.hexes).map(Number).concat(index.reveal));
      for (const person of people) {
        try {
          const n = locationHex(person.location, places, prefix);
          if (n === null || !explored.has(n)) continue;
          (index.characters[n] = index.characters[n] || []).push(person.name);
        } catch (e) {
          // leave this character off the map
        }
      }
      for (const n of Object.keys(index.characters)) {
        index.characters[n].sort((a, b) => a.localeCompare(b));
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
