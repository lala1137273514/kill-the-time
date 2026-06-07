"use strict";

// Generic prompt loader for the glass-box layer. Prompts live as .md files in
// src/prompts/ so they can be edited without touching code (and, later, exposed
// in settings — direction 4). fs/dir are injectable for unit tests. Let it
// crash: a missing or unreadable prompt file throws, with no fallback to an
// inlined default. Direction 2b's router/supervisor prompts will reuse this.

const fs = require("fs");
const path = require("path");

const PROMPTS_DIR = path.join(__dirname, "prompts");

function loadPrompt(name, opts = {}) {
  const fsImpl = opts.fs || fs;
  const dir = opts.dir || PROMPTS_DIR;
  return fsImpl.readFileSync(path.join(dir, name + ".md"), "utf8").trimEnd();
}

module.exports = { PROMPTS_DIR, loadPrompt };
