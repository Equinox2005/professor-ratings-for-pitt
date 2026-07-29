/**
 * Offscreen model host.
 *
 * Runs Qwen2.5-0.5B via Transformers.js + WebGPU: a ~300 MB one-time download,
 * fully offline afterwards.
 *
 * The model only ever phrases facts computed by the heuristic analyzer. It is
 * never asked to read raw reviews, because at this size it is unreliable at
 * extraction but adequate at rephrasing.
 *
 * This lives in an offscreen document rather than the service worker because
 * model sessions are expensive to create and MV3 workers get killed.
 */

import * as local from './lib/localmodel.js';

/* ---------------------------------------------------------------- */
/* Status + progress broadcasting                                    */
/* ---------------------------------------------------------------- */

function broadcastProgress(p) {
  chrome.runtime.sendMessage({ type: 'MODEL_PROGRESS', progress: p }).catch(() => {});
}

async function status() {
  const gpu = await local.webgpuAvailable();
  return { local: { ...local.status(), webgpu: gpu } };
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
          await local.load(broadcastProgress);
          return { status: 'ok' };
        } catch (err) {
          return { status: 'error', message: String(err.message || err) };
        } finally {
          endWork();
        }

      case 'SUMMARIZE': {
        const { teacher, analysis } = msg;
        beginWork();
        try {
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
