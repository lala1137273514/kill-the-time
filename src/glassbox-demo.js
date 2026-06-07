"use strict";

// One-key Demo mode (Ctrl+Shift+D) — a fully synthetic showcase of the glass-box
// flow for competition judges: it drives the SAME phase relay (pet + input-bar
// "glass box") and TTS as a real run, but touches no agent, mic, or key, so it
// always plays cleanly. Pure script + injectable runner so it's unit-tested;
// main.js wires the real effects (relayGlassboxPhase / speak / setTimeout).

function demoSteps() {
  return [
    { phase: "thinking",    say: "让我想想怎么干哈",   holdMs: 1500 },
    { phase: "capturing",   say: "我瞄一眼你屏幕",     holdMs: 1200 },
    { phase: "confirming",  say: "这事儿我要派出去咯", holdMs: 1500 },
    { phase: "dispatching", say: "交给 Claude",        holdMs: 1000 },
    { phase: "running",     say: "它在跑了，稍等",     holdMs: 2500 },
    { phase: "done",        say: "搞定，你看下结果",   holdMs: 1600 },
  ];
}

// runDemo({ emitPhase, speak, sleep, isCancelled, steps }) -> { completed, ran }
// Each effect is injected; cancellation is polled at the top of every step so a
// second hotkey press / Esc stops the showcase cleanly.
async function runDemo(deps = {}) {
  const emitPhase = typeof deps.emitPhase === "function" ? deps.emitPhase : () => {};
  const speak = typeof deps.speak === "function" ? deps.speak : () => {};
  const sleep = typeof deps.sleep === "function" ? deps.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const isCancelled = typeof deps.isCancelled === "function" ? deps.isCancelled : () => false;
  const steps = Array.isArray(deps.steps) ? deps.steps : demoSteps();

  let ran = 0;
  for (const step of steps) {
    if (isCancelled()) return { completed: false, ran };
    emitPhase(step.phase);
    if (step.say) speak(step.say);
    await sleep(step.holdMs);
    ran++;
  }
  return { completed: !isCancelled(), ran };
}

module.exports = { demoSteps, runDemo };
