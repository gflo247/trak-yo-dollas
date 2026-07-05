// Pulls specific top-level `function name(...) { ... }` declarations out of
// trakyodollas.html by brace-matching, so tests exercise the actual current
// source in the shipped file rather than a hand-copied duplicate that can
// drift out of sync with it. This file is a monolithic, non-modular HTML
// app with no build step — there is nothing to `require()` directly, so
// this is the least invasive way to unit-test its pure functions without
// restructuring the app itself.
// Lives in scripts/, not test/ — node --test auto-runs every file inside
// any directory literally named "test" (recursively), which turned this
// helper into a phantom zero-assertion "passing test" the one time it sat
// there.
"use strict";
const fs = require("fs");
const path = require("path");

function extractFunctions(source, names) {
  const wanted = new Set(names);
  const found = {};
  const re = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1];
    if (!wanted.has(name) || found[name]) continue;
    const braceStart = source.indexOf("{", m.index);
    if (braceStart === -1) continue;
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    found[name] = source.slice(m.index, i);
  }
  const missing = names.filter((n) => !found[n]);
  if (missing.length) {
    throw new Error(`extractFunctions: could not find function(s) in source: ${missing.join(", ")}`);
  }
  return found;
}

// Loads the named functions from trakyodollas.html into a real, callable
// object — e.g. loadFunctions(['esc','classifyBudgetStatus']).esc('<x>').
// `context` lets a caller pre-seed variables the functions close over
// (e.g. `_getOrCreateSalt`, `sessionStorage`).
//
// Compiled via `new Function` (not the `vm` module) specifically so the
// extracted code runs in *this* realm — a separate vm context has its own
// Array/Object/etc., and values crossing that boundary fail Node's
// deepStrictEqual (same shape, different prototype identity) even though
// they're functionally identical.
function loadFunctions(names, context) {
  const htmlPath = path.join(__dirname, "..", "trakyodollas.html");
  const source = fs.readFileSync(htmlPath, "utf8");
  const fns = extractFunctions(source, names);
  const ctxKeys = Object.keys(context || {});
  const body = Object.values(fns).join("\n") + "\nreturn {" + names.join(",") + "};";
  const factory = new Function(...ctxKeys, body); // eslint-disable-line no-new-func
  return factory(...ctxKeys.map((k) => context[k]));
}

module.exports = { extractFunctions, loadFunctions };
