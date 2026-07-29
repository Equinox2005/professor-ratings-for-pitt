/**
 * Offscreen model host.
 *
 * Two engines are supported:
 *   local  -- Qwen2.5-0.5B via Transformers.js + WebGPU (~300 MB one-time
 *             download, then fully offline)
 *   nano   -- Chrome's built-in Gemini Nano, when the machine qualifies
 *
 * Both only ever phrase facts computed by the heuristic analyzer. Neither is
 * asked to read raw reviews, because at these sizes they are unreliable at it.
 *
 * This lives in an offscreen document rather than the service worker because
 * model sessions are expensive to create and MV3 workers get killed.
 */

import * as local from './lib/localmodel.js';

/* ---------------------------------------------------------------- */
/* Gemini Nano                                                       */
/* ---------------------------------------------------------------- */

const NANO_SYSTEM = [
  'You write short, blunt course-registration advice for university students.',
  'You are given verified facts about a professor. Restate them in plain prose.',
  'Never invent numbers, courses, or opinions not present in the facts.',
  'No preamble, no markdown. Two or three sentences maximum.',
].join(' ');

let nanoBase = null;

function nanoSupported() {
  return typeof LanguageModel !== 'undefined';
}

async function nanoAvailability() {
  if (!nanoSupported()) return 'unsupported';
  try {
    return await LanguageModel.availability();
  } catch {
    return 'unavailable';
  }
}

async function nanoSession() {
  if (!nanoSupported()) throw new Error('Prompt API not present');
  const state = await nanoAvailability();
  if (state === 'unavailable' || state === 'unsupported') {
    throw new Error('Gemini Nano not available on this device');
  }
  if (!nanoBase) {
    nanoBase = LanguageModel.create({
      initialPrompts: [{ role: 'system', content: NANO_SYSTEM }],
    }).catch((err) => {
      nanoBase = null;
      throw err;
    });
  }
  return nanoBase;
}

async function nanoSummarize(teacher, analysis) {
  const base = await nanoSession();
  const session = await base.clone();
  try {
    const text = await session.prompt(
      `Facts about this professor:\n${local.factSheet(teacher, analysis)}\n\nWrite the advice now.`
    );
    return String(text || '').replace(/\s+/g, ' ').trim();
  } finally {
    try { session.destroy(); } catch { /* already gone */ }
  }
}

/* ---------------------------------------------------------------- */
/* Status + progress broadcasting                                    */
/* ---------------------------------------------------------------- */

function broadcastProgress(p) {
  chrome.runtime.sendMessage({ type: 'MODEL_PROGRESS', progress: p }).catch(() => {});
}

async function status() {
  const [nano, gpu] = await Promise.all([nanoAvailability(), local.webgpuAvailable()]);
  return {
    nano: { supported: nanoSupported(), availability: nano },
    local: { ...local.status(), webgpu: gpu },
  };
}


/* ---------------------------------------------------------------- */
/* Idle shutdown                                                     */
/* ---------------------------------------------------------------- */

// A loaded 0.5B model plus the ONNX runtime is hundreds of MB of RAM and GPU
// memory. Holding that for a whole browser session to save a few seconds on a
// possible next summary is a bad trade, especially on 8 GB machines. The
// document closes itself once idle; background.js recreates it on demand and
// the weights reload from browser cache.
const IDLE_SHUTDOWN_MS = 3 * 60 * 1000;

let idleTimer = null;
let busy = 0;

function scheduleShutdown() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (busy > 0) { scheduleShutdown(); return; }
    try { window.close(); } catch { /* already gone */ }
  }, IDLE_SHUTDOWN_MS);
}

function beginWork() {
  busy += 1;
  clearTimeout(idleTimer);
}

function endWork() {
  busy = Math.max(0, busy - 1);
  if (busy === 0) scheduleShutdown();
}

scheduleShutdown();

/* ---------------------------------------------------------------- */
/* Router                                                            */
/* ---------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.__target !== 'offscreen') return false;

  (async () => {
    switch (msg.type) {
      case 'AI_STATUS':
        return status();

      case 'WARMUP':
        beginWork();
        try {
          if (msg.engine === 'nano') {
            await nanoSession();
          } else {
            await local.load(broadcastProgress);
          }
          return { status: 'ok' };
        } catch (err) {
          return { status: 'error', message: String(err.message || err) };
        } finally {
          endWork();
        }

      case 'SUMMARIZE': {
        const { teacher, analysis, engine } = msg;
        beginWork();
        try {
          if (engine === 'nano') {
            const text = await nanoSummarize(teacher, analysis);
            return text ? { status: 'ok', engine: 'nano', text } : { status: 'empty' };
          }
          const text = await local.summarize(teacher, analysis);
          return text ? { status: 'ok', engine: 'local', text } : { status: 'empty' };
        } catch (err) {
          return { status: 'unavailable', message: String(err.message || err) };
        } finally {
          endWork();
        }
      }

      default:
        return { status: 'unknown' };
    }
  })().then(sendResponse);

  return true;
});
