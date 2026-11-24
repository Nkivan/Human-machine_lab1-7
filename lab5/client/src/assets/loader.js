// Asset pipeline: fetch + retry + abort + progress. No class hierarchies, just promises.

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 5000;
const isAbort = (err) => err?.name === "AbortError";

// 4xx = our mistake (never retry). 5xx, network failures and timeouts are transient.
function isRetryable(err) {
  if (err instanceof HttpError) return err.status >= 500;
  return err instanceof TypeError || err?.name === "TimeoutError";
}

// Hand-wrapped callback API (setTimeout) -> promise, cancellable via AbortSignal.
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal.reason);
    };
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const withTimeout = (signal, ms) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

async function request(url, { signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const res = await fetch(url, { signal: withTimeout(signal, timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, url); // fetch does NOT reject on 404/500
  return res;
}

export async function fetchJson(url, opts) {
  return (await request(url, opts)).json(); // rejects with SyntaxError on corrupt JSON
}

export async function loadImage(url, opts) {
  return createImageBitmap(await (await request(url, opts)).blob());
}

export async function loadAudio(ctx, url, opts) {
  return ctx.decodeAudioData(await (await request(url, opts)).arrayBuffer());
}

// Exponential backoff + full jitter. Never retries aborts or 4xx.
export async function withRetry(fn, { attempts = 3, baseMs = 300, signal } = {}) {
  for (let i = 0; ; i++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (err) {
      if (isAbort(err) || !isRetryable(err) || i >= attempts - 1) throw err;
      await delay(baseMs * 2 ** i * (0.5 + Math.random()), signal);
    }
  }
}

// Concurrent by default (Promise.all) with per-item progress.
// Optional assets (sounds) that fail are recorded in `failures` instead of blocking the game.
export async function loadAll(
  manifest,
  { ctx, onProgress = () => {}, signal, sequential = false } = {},
) {
  const inner = new AbortController(); // lets us cancel siblings when a REQUIRED asset fails
  signal?.addEventListener("abort", () => inner.abort(signal.reason), { once: true });
  const s = inner.signal;

  const jobs = [];
  const add = (group, name, spec, run) =>
    jobs.push({ group, name, optional: !!spec.optional, run });
  for (const [name, spec] of Object.entries(manifest.sprites ?? {}))
    add("images", name, spec, () => loadImage(spec.url, { signal: s }));
  for (const [name, spec] of Object.entries(manifest.sounds ?? {}))
    add("sounds", name, spec, () => loadAudio(ctx, spec.url, { signal: s }));
  for (const [name, spec] of Object.entries(manifest.json ?? {}))
    add("json", name, spec, () => fetchJson(spec.url, { signal: s }));

  const failures = [];
  let done = 0;
  const run = (job) =>
    withRetry(job.run, { signal: s })
      .catch((err) => {
        if (isAbort(err) || !job.optional) throw err;
        failures.push({ name: job.name, error: err });
        return null;
      })
      .then((value) => {
        onProgress(++done / jobs.length, job.name);
        return value;
      });

  let results;
  try {
    if (sequential) {
      results = [];
      for (const job of jobs) results.push(await run(job));
    } else results = await Promise.all(jobs.map(run));
  } catch (err) {
    inner.abort(err); // stop the siblings; Promise.all alone would let them keep running
    throw err;
  }

  const out = { images: {}, sounds: {}, json: {}, frames: manifest.frames ?? {}, failures };
  jobs.forEach((job, i) => {
    out[job.group][job.name] = results[i];
  });
  return out;
}
