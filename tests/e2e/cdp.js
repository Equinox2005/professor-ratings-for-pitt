// A small Chrome DevTools Protocol client over --remote-debugging-pipe.
// Chrome only accepts Extensions.loadUnpacked over the pipe, and branded
// Chrome no longer honours --load-extension, so this is how the e2e run
// installs the unpacked extension.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = {
    win32: [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform];
  return (candidates ?? []).find((path) => existsSync(path)) ?? null;
}

export async function launchChrome({ chromePath, profileDir, width = 1440, height = 900, headless = true, offline = true, position }) {
  const args = [
    ...(headless ? ['--headless'] : []),
    ...(position ? [`--window-position=${position}`] : []),
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Nothing may reach a real host; run.js answers every request itself.
    // The demo turns this off: the model download and --live need the network.
    ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND'] : []),
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => proc.once('exit', resolve));

  const events = new EventEmitter();
  const pending = new Map();
  let nextId = 1;
  let buffer = Buffer.alloc(0);

  proc.stdio[4].on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (let end = buffer.indexOf(0); end !== -1; end = buffer.indexOf(0)) {
      const message = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      buffer = buffer.subarray(end + 1);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, method } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      } else if (message.method) {
        events.emit(message.method, message.params, message.sessionId);
      }
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }) + '\0');
    });

  const close = async () => {
    await send('Browser.close').catch(() => {});
    const timer = setTimeout(() => proc.kill(), 3000);
    await exited;
    clearTimeout(timer);
  };

  await send('Browser.getVersion');
  return { send, events, close, exited };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(fn, { timeout = 10_000, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}
