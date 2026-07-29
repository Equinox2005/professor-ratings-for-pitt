/**
 * Local language model engine: Qwen2.5-0.5B-Instruct via Transformers.js.
 *
 * Design note that matters more than the model choice:
 *
 * A 0.5B model is bad at reading sixteen reviews and extracting what matters.
 * It is considerably better at rephrasing facts it has been handed. So the
 * heuristic analyzer in summarize.js still does all the extraction — aspect
 * sentiment, per-course splits, trend — and the model only turns that
 * structured result into readable prose. That keeps the numbers exact and
 * confines the model to the one job it can actually do at this size.
 *
 * Everything runs offline after the first download. Nothing is sent anywhere.
 */

import { pipeline, env } from '../vendor/transformers.web.min.js';

export const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

/* Runtime configuration ------------------------------------------------ */

// MV3 forbids remote code, so the ONNX runtime is bundled and loaded locally.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/');
// Threads need SharedArrayBuffer, which needs cross-origin isolation we can't
// set on an offscreen document. WebGPU does the heavy lifting anyway.
env.backends.onnx.wasm.numThreads = 1;
env.allowLocalModels = false;
env.useBrowserCache = true;

/* ---------------------------------------------------------------------- */

let generator = null;
let loadPromise = null;
export const progress = { status: 'idle', pct: 0, file: '' };

export async function webgpuAvailable() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export async function load(onProgress) {
  if (generator) return generator;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const gpu = await webgpuAvailable();
    if (!gpu) {
      progress.status = 'no-webgpu';
      throw new Error('WebGPU unavailable — this GPU or driver cannot run the model');
    }

    progress.status = 'loading';

    generator = await pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',
      device: 'webgpu',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) {
          progress.status = 'downloading';
          progress.pct = Math.round((p.loaded / p.total) * 100);
          progress.file = p.file || '';
        } else if (p.status === 'ready' || p.status === 'done') {
          progress.status = 'ready';
          progress.pct = 100;
        }
        if (onProgress) onProgress({ ...progress });
      },
    });

    progress.status = 'ready';
    progress.pct = 100;
    return generator;
  })().catch((err) => {
    loadPromise = null;
    generator = null;
    if (progress.status !== 'no-webgpu') progress.status = 'error';
    throw err;
  });

  return loadPromise;
}

/* Prompt --------------------------------------------------------------- */

const SYSTEM = [
  'You write short, blunt course-registration advice for university students.',
  'You are given verified facts about a professor. Restate them in plain prose.',
  'Never invent numbers, courses, or opinions that are not in the facts.',
  'No preamble, no bullet points, no markdown. Two or three sentences maximum.',
].join(' ');

/** Turn the heuristic's structured output into a compact fact sheet. */
export function factSheet(teacher, analysis) {
  const lines = [];

  if (teacher.avgRating) lines.push(`Overall rating: ${teacher.avgRating.toFixed(1)} out of 5.`);
  if (teacher.avgDifficulty) lines.push(`Difficulty: ${teacher.avgDifficulty.toFixed(1)} out of 5.`);
  if (teacher.wouldTakeAgainPercent !== null && teacher.wouldTakeAgainPercent !== undefined) {
    lines.push(`${teacher.wouldTakeAgainPercent}% of students would take this professor again.`);
  }
  lines.push(`Based on ${teacher.numRatings} ratings.`);

  for (const a of analysis.aspects || []) {
    lines.push(`${a.label}: students are ${a.sentiment} about this (${a.mentions} mentions).`);
  }

  for (const c of analysis.courses || []) {
    lines.push(`In ${c.code}: rated ${c.avg ?? 'unrated'} out of 5 across ${c.count} reviews.`);
  }

  if (analysis.trend) lines.push(analysis.trend);

  return lines.join('\n');
}

/* Generation ----------------------------------------------------------- */

let queue = Promise.resolve();

/** Serialize generation; one 0.5B model instance can't handle parallel calls. */
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function summarize(teacher, analysis) {
  const gen = await load();

  return enqueue(async () => {
    const messages = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Facts about this professor:\n${factSheet(teacher, analysis)}\n\nWrite the advice now.`,
      },
    ];

    const out = await gen(messages, {
      max_new_tokens: 110,
      do_sample: false,
      temperature: 1.0,
      return_full_text: false,
    });

    const text = extractText(out);
    return clean(text);
  });
}

function extractText(out) {
  if (!out) return '';
  const first = Array.isArray(out) ? out[0] : out;
  const gt = first?.generated_text;
  if (typeof gt === 'string') return gt;
  if (Array.isArray(gt)) {
    const last = gt[gt.length - 1];
    return typeof last === 'string' ? last : last?.content || '';
  }
  return '';
}

function clean(text) {
  let t = String(text || '')
    .replace(/^(assistant|answer|advice)\s*:?\s*/i, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Small models often trail off mid-sentence at the token cap; cut cleanly.
  const lastStop = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'));
  if (lastStop > 40) t = t.slice(0, lastStop + 1);

  return t;
}

export function status() {
  return { model: MODEL_ID, ...progress, loaded: !!generator };
}
