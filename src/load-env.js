"use strict";

// Minimal .env loader (no dependency). Lets the user drop BAILIAN_API_KEY (and
// other CLAWD_*/DASHSCOPE_* knobs) into a gitignored .env at the repo root once,
// instead of exporting it before every `npm start`. The shell env always wins —
// .env only fills keys that are not already set, so it never overrides an
// explicit export. The API key stays out of prefs/git, per AGENTS.md.

const fs = require("fs");
const path = require("path");

// Parse .env text into a flat { KEY: value } map. Pure.
function parseEnv(text) {
  const out = {};
  if (typeof text !== "string") return out;
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Read filePath and set any keys NOT already present in env. Missing file is a
// no-op (returns []). Returns the list of keys it actually set.
function loadEnvFile(filePath, { env = process.env, readFileImpl = fs.readFileSync } = {}) {
  let text;
  try {
    text = readFileImpl(filePath, "utf8");
  } catch {
    return [];
  }
  const parsed = parseEnv(text);
  const set = [];
  for (const key of Object.keys(parsed)) {
    if (env[key] === undefined || env[key] === "") {
      env[key] = parsed[key];
      set.push(key);
    }
  }
  return set;
}

// Convenience: load the repo-root .env (src/.. ) into process.env.
function loadRepoEnv() {
  return loadEnvFile(path.join(__dirname, "..", ".env"));
}

module.exports = { parseEnv, loadEnvFile, loadRepoEnv };
