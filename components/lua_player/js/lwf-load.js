
let chain = Promise.resolve();

function raceTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label || 'task'} timeout (${ms}ms)`)),
      ms,
    );
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function enqueueLwfLoad(task) {
  const run = chain.then(
    () => Promise.resolve().then(task),
    () => Promise.resolve().then(task),
  );

  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export function resetLwfLoadQueue() {
  chain = Promise.resolve();
}

export function loadLwfWithRetry(cache, opts, ctl = {}) {
  const retries = ctl.retries ?? 1;
  const log = ctl.log || (() => {});
  let attempt = 0;
  let finished = false;

  return new Promise((resolve, reject) => {
    const finishOk = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };
    const finishErr = (err) => {
      if (finished) return;
      finished = true;
      reject(err);
    };

    const tryLoad = () => {
      if (finished) return;
      attempt += 1;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled || finished) return;
        settled = true;
        if (attempt <= retries) {
          log(`LWF load timeout — retry ${attempt}/${retries}`);
          tryLoad();
        } else {
          finishErr(new Error(`LWF load timeout: ${opts.lwf}`));
        }
      }, ctl.timeoutMs ?? 300000);

      const userOnload = opts.onload;
      try {
        cache.loadLWF({
          ...opts,
          onload(lwfInstance) {
            if (settled || finished) return;
            settled = true;
            clearTimeout(timer);
            if (!lwfInstance) {
              const detail = (this.error || [])
                .map((e) => `${e.reason || '?'}:${e.url || '?'}`)
                .join(' | ');
              if (attempt <= retries) {
                log(
                  `LWF null (${detail || 'texture error'}) — retry ${attempt}/${retries}`,
                );
                setTimeout(tryLoad, 120 * attempt);
                return;
              }
              finishErr(
                new Error(
                  `LWF load returned null for ${opts.lwf}` +
                    (detail ? ` [${detail}]` : ''),
                ),
              );
              return;
            }
            if (typeof userOnload === 'function') {
              try {
                userOnload.call(this, lwfInstance);
                finishOk(lwfInstance);
              } catch (e) {
                finishErr(e);
              }
            } else {
              finishOk(lwfInstance);
            }
          },
        });
      } catch (e) {
        clearTimeout(timer);
        finishErr(e instanceof Error ? e : new Error(String(e)));
      }
    };
    tryLoad();
  });
}
