import { setActivePatchId, withPatchQuery, getApiBase } from './patch-context.js?v=dokkan2026_v10';
import { fetchFresh } from './fetch-fresh.js?v=dokkan2026_v10';
import {
  CONDITION_DEFS,
  detectUsedConditions,
  mountConditionList,
  defaultConditionValues,
  cutinHelperHint,
} from './conditions.js?v=dokkan2026_v19';
import { initStage, setPhoneCrop, watchStageFit } from './stage.js?v=dokkan2026_v10';
import { createLuaHost, ensureFengari } from './lua-host.js?v=dokkan2026_v10';
import { installBinders } from './binders.js?v=dokkan2026_v10';
import { ActionBankRunner } from './runner.js?v=dokkan2026_v32';
import { LwfLayer } from './lwf-player.js?v=dokkan2026_v32';
import { UsmLayer } from './usm-player.js?v=dokkan2026_v30';
import { CharaLayer } from './chara-layer.js?v=dokkan2026_v10';
import { BattleBgLayer, ScreenFade } from './bg-layer.js?v=dokkan2026_v10';
import { AudioBus } from './audio-bus.js?v=dokkan2026_v16';
import { ReferenceMode } from './reference-mode.js?v=dokkan2026_v10';
import { StageRecorder } from './recorder.js?v=dokkan2026_v10';
import { clearEffectPackCache } from './effect-pack.js?v=dokkan2026_v10';
import { fetchCard, clearCardCache } from './card-resolve.js?v=eclipse24';
import { ensureLwfCanvasBlendModes } from './lwf-blend.js?v=dokkan2026_v30';
import { exportSheetsZip, downloadBlob } from './sheet-export.js?v=dokkan2026_v10';

const $ = (id) => document.getElementById(id);

const DEFAULT_ATTACKER_ID = 1000010;const DEFAULT_ENEMY_ID = 1033701;

const SETTINGS_KEY = 'ab-lua-player:settings:v1';

let openedScript = null;
let allScripts = [];

let loadedSession = null;
let currentLoadOptions = {};
let rebindTimer = null;
let rebindInFlight = null;

let transportBusy = false;

const logEl = $('log');
const statusBar = $('statusBar');
const conditionValues = defaultConditionValues();

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (logEl) {
    logEl.textContent = `${logEl.textContent}${line}\n`.slice(-12000);
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(msg);
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function saveSettings() {
  const data = {
    scriptPath: $('scriptPath').value.trim(),
    attackerCardId: $('attackerCardId').value,
    enemyCardId: $('enemyCardId').value,
    levelBgId: $('levelBgId').value,
    dokkanFieldId: $('dokkanFieldId').value,
    phoneCrop: $('phoneCrop').checked,
    highSpeed: $('highSpeed').checked,
    loopBank: $('loopBank').checked,
  };
  if (openedScript?.text && openedScript.path === data.scriptPath) {
    data.openedText = openedScript.text;
    data.openedName = openedScript.name || '';
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch (e) {

    try {
      delete data.openedText;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      log(`Could not save settings: ${e.message || e}`);
    }
  }
}

function applySettings(data) {
  if (!data) return;
  if (data.attackerCardId != null && data.attackerCardId !== '') {
    $('attackerCardId').value = data.attackerCardId;
  }
  if (data.enemyCardId != null && data.enemyCardId !== '') {
    $('enemyCardId').value = data.enemyCardId;
  }
  if (data.levelBgId != null && data.levelBgId !== '') {
    $('levelBgId').value = data.levelBgId;
  }
  if (data.dokkanFieldId != null && data.dokkanFieldId !== '') {
    $('dokkanFieldId').value = data.dokkanFieldId;
  }
  if (typeof data.phoneCrop === 'boolean') $('phoneCrop').checked = data.phoneCrop;
  if ($('highSpeed')) $('highSpeed').checked = false;
  if (typeof data.loopBank === 'boolean') $('loopBank').checked = data.loopBank;
  if (typeof data.scriptPath === 'string' && data.scriptPath.trim()) {
    $('scriptPath').value = data.scriptPath.trim();
  }
  if (typeof data.openedText === 'string' && data.openedText && data.scriptPath) {
    openedScript = {
      path: String(data.scriptPath).trim(),
      text: data.openedText,
      name: data.openedName || String(data.scriptPath).split(/[/\\]/).pop() || 'script.lua',
    };
  }
}

function bindSettingsPersistence() {
  const onChange = () => saveSettings();
  for (const id of [
    'scriptPath',
    'attackerCardId',
    'enemyCardId',
    'levelBgId',
    'dokkanFieldId',
    'phoneCrop',
    'highSpeed',
    'loopBank',
  ]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('change', onChange);
    if (el.tagName === 'INPUT' && el.type !== 'checkbox') {
      el.addEventListener('input', onChange);
    }
  }
}

function normalizeScriptPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function matchScriptPath(fileName, filePathHint = '') {
  const name = String(fileName || '').replace(/\\/g, '/').split('/').pop();
  if (!name) return '';
  const hint = normalizeScriptPath(filePathHint);
  if (hint) {
    const hit = allScripts.find((s) => normalizeScriptPath(s.path) === hint);
    if (hit) return hit.path;
    const ab = hint.includes('ab_script/') ? hint.slice(hint.indexOf('ab_script/')) : '';
    if (ab) {
      const hit2 = allScripts.find((s) => normalizeScriptPath(s.path) === ab);
      if (hit2) return hit2.path;
    }
  }
  const lower = name.toLowerCase();
  const ends = allScripts.filter((s) =>
    normalizeScriptPath(s.path).toLowerCase().endsWith('/' + lower) ||
    normalizeScriptPath(s.path).toLowerCase() === lower,
  );
  if (ends.length === 1) return ends[0].path;
  if (ends.length > 1) {

    const pref = ends.find((s) => /\/(attack_sp|ultimate|active_skill|enemy)\//i.test(s.path));
    return (pref || ends[0]).path;
  }
  return '';
}

function syncSelectToPath(path) {
  const sel = $('scriptSelect');
  if (!sel) return;
  const want = normalizeScriptPath(path);
  if (!want) {
    if (sel.options.length) sel.selectedIndex = 0;
    return;
  }
  for (const opt of sel.options) {
    if (normalizeScriptPath(opt.value) === want) {
      sel.value = opt.value;
      return;
    }
  }

  const opt = document.createElement('option');
  opt.value = want;
  const short = want.replace(/^ab_script\//, '');
  opt.textContent = want.startsWith('local/') ? `${short} (opened)` : short;
  opt.dataset.ephemeral = '1';
  sel.insertBefore(opt, sel.firstChild);
  sel.value = want;
}

function fillScriptSelect(filter = '') {
  const sel = $('scriptSelect');
  if (!sel) return;
  const prev = $('scriptPath')?.value.trim() || '';
  const q = String(filter || '').trim().toLowerCase();
  const list = q
    ? allScripts.filter((s) => String(s.path || '').toLowerCase().includes(q))
    : allScripts;

  const MAX_OPTIONS = 400;
  const shown = list.slice(0, MAX_OPTIONS);
  sel.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const s of shown) {
    if (!s?.path) continue;
    const opt = document.createElement('option');
    opt.value = s.path;
    opt.textContent = s.path.replace(/^ab_script\//, '');
    frag.appendChild(opt);
  }
  if (!frag.childNodes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = q ? '(no matches)' : '(no scripts)';
    frag.appendChild(opt);
  } else if (list.length > MAX_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = `… ${list.length - MAX_OPTIONS} more — type to filter`;
    frag.appendChild(opt);
  }
  sel.appendChild(frag);
  if (prev) {
    $('scriptPath').value = prev;
    syncSelectToPath(prev);
  } else if (shown.length) {
    sel.selectedIndex = 0;
    $('scriptPath').value = sel.value;
  }
  const hint = $('scriptListHint');
  if (hint) {
    hint.textContent = q
      ? `Showing ${shown.length} / ${list.length} matches (${allScripts.length} total)`
      : `${allScripts.length} scripts loaded`;
  }
}

function setTransport({ ready = false, playing = false, paused = false } = {}) {
  const canPlay = ready && (!playing || paused);
  const play = $('btnPlay');
  const pause = $('btnPause');
  const stop = $('btnStop');
  const record = $('btnRecord');
  if (play) {
    play.disabled = !canPlay;
    play.textContent = paused ? 'Resume' : 'Play';
  }
  if (pause) pause.disabled = !playing || paused;
  if (stop) stop.disabled = !playing && !paused;
  if (record) record.disabled = !ready;
  const split = $('btnSplitSheets');
  if (split) split.disabled = !ready;
  const miniPlayIcon = $('miniPlayIcon');
  if (miniPlayIcon) {
    miniPlayIcon.textContent = playing ? '⏸️' : '▶️';
  }
}

async function collectSheetExportPacks() {
  const seen = new Set();
  const packs = [];
  const add = async (lwfUrl, packHint) => {
    const url = String(lwfUrl || '').split('?')[0];
    if (!url || seen.has(url)) return;
    seen.add(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    const leaf = url.split('/').pop() || 'pack.lwf';
    const packName = String(packHint || leaf)
      .replace(/\.lwf$/i, '')
      .replace(/[<>:"/\\|?*]/g, '_');
    packs.push({
      lwfBytes: bytes,
      packName,
      log,
      exportTransforms: !!$('exportTransforms')?.checked,
      cleanSlices: !$('keepAtlasPadding')?.checked,
      resolveSheetUrl: (filename) => {
        const fn = String(filename || '').replace(/^.*[/\\]/, '');
        if (!fn) return null;
        return base + fn;
      },
    });
  };

  for (const p of lwf.players || []) {
    if (p.assetUrl) {
      await add(p.assetUrl, p.assetUrl.split('/').pop());
    }
  }
  for (const c of chara.chars?.values?.() || []) {
    if (c.assetUrl) await add(c.assetUrl, `chara${c.id}_battle`);
    if (c.spAssetUrl) await add(c.spAssetUrl, `chara${c.id}_sp`);
  }
  return packs;
}

function invalidateLoadedScript(reason = '') {
  if (runner.playing || runner.userPaused) {
    runner.stop({ clearVisuals: false, silent: true });
  }
  if (rebindTimer) {
    clearTimeout(rebindTimer);
    rebindTimer = null;
  }
  loadedSession = null;
  runner.ready = false;
  setTransport({ ready: false, playing: false, paused: false });
  statusBar.textContent = reason || 'Script changed — Load to play';
}

function onScriptPathPicked() {
  const path = $('scriptPath').value.trim();
  const loaded = loadedSession?.path ? normalizeScriptPath(loadedSession.path) : '';
  if (loaded && normalizeScriptPath(path) !== loaded) {
    invalidateLoadedScript('Script changed — Load to play');
  }
}

function readCardIds() {
  let attackerId = Number($('attackerCardId').value) || 0;
  let enemyId = Number($('enemyCardId').value) || 0;
  const usedDefaults = [];
  if (!attackerId) {
    attackerId = DEFAULT_ATTACKER_ID;
    usedDefaults.push(`atk→${attackerId}`);
  }
  if (!enemyId) {
    enemyId = DEFAULT_ENEMY_ID;
    usedDefaults.push(`eny→${enemyId}`);
  }
  return { attackerId, enemyId, usedDefaults };
}

async function resolveCards() {
  const { attackerId, enemyId, usedDefaults } = readCardIds();
  let attacker = { found: false, id: attackerId };
  let enemy = { found: false, id: 0 };
  try {
    [attacker, enemy] = await Promise.all([
      fetchCard(attackerId).catch(() => ({ found: false, id: attackerId })),
      fetchCard(enemyId).catch(() => ({ found: false, id: enemyId })),
    ]);
    const cutInCardId = Number(
      currentLoadOptions.cut_in_card_id || currentLoadOptions.cutInCardId || 0,
    );
    if (cutInCardId > 0) {
      const cutInCard = await fetchCard(cutInCardId).catch(() => null);
      if (cutInCard?.found && attacker?.found) {
        attacker = {
          ...attacker,
          textures: {
            ...(attacker.textures || {}),
            cutin: cutInCard.textures?.cutin || cutInCard.textures?.sp_cutin,
            sp_cutin: cutInCard.textures?.sp_cutin || cutInCard.textures?.cutin,
          },
        };
      }
    }
    const specialNameNo = Number(
      currentLoadOptions.special_name_no || currentLoadOptions.specialNameNo || 0,
    );
    if (specialNameNo > 0 && attacker?.found && attacker.art_id) {
      const artId = Number(attacker.art_id);
      const spNameUrl = `/assets/character/card/${artId}/en/card_${artId}_sp_name_${specialNameNo}.png`;
      attacker = {
        ...attacker,
        textures: {
          ...(attacker.textures || {}),
          sp_name: { url: spNameUrl, rel: spNameUrl.replace(/^\/assets\//, '') },
        },
      };
    }
  } catch (e) {
    log(`Card resolve failed: ${e.message || e}`);
    return { attacker, enemy, attackerId, enemyId };
  }
  const bits = [];
  if (usedDefaults.length) bits.push(`defaults ${usedDefaults.join(',')}`);
  if (attacker.found) {
    bits.push(
      `atk ${attacker.id} ch${attacker.character_id}` +
        (attacker.character_size != null ? ` sz${attacker.character_size}` : '') +
        (attacker.battle ? ' battle' : ' no-battle') +
        (attacker.textures?.character ? ' art' : ' no-art'),
    );
  } else bits.push(`atk ${attackerId} missing`);
  if (enemy.found) {
    bits.push(
      `eny ${enemy.id} ch${enemy.character_id}` +
        (enemy.character_size != null ? ` sz${enemy.character_size}` : '') +
        (enemy.battle ? ' battle' : ' no-battle'),
    );
  } else bits.push(`eny ${enemyId} missing`);
  log(`Cards: ${bits.join(' | ')}`);
  return { attacker, enemy, attackerId, enemyId };
}

const stage = $('stage');
let bg;
let screenFade;
let lwf;
let usm;
let chara;
let audio;
let recorder;
let runner;
let refMode;
let initError = null;
// Removing/changing the iframe must end audio, video and background work now,
// rather than leaving a live AudioContext holding the old document until GC.
window.addEventListener('pagehide', () => {
  clearTimeout(rebindTimer);
  runner?.resetTimeline();
  if (runner?._visHandler) document.removeEventListener('visibilitychange', runner._visHandler);
  audio?.dispose();
  loadedSession = null;
});
try {
  ensureLwfCanvasBlendModes();
  bg = new BattleBgLayer($('bgLayer'), log);
  screenFade = new ScreenFade(stage);
  lwf = new LwfLayer($('lwfHost'), log);
  usm = new UsmLayer($('movieHost'), log);
  chara = new CharaLayer($('charaHost'), log);
  audio = new AudioBus(log);
  recorder = new StageRecorder(stage, log);
  recorder.setSources({ lwf, chara, usm, bg });

  const progressWidget = $('loadProgressWidget');
  const progressTitle = $('loadProgressTitle');
  const progressCount = $('loadProgressCount');
  const progressBar = $('loadProgressBar');
  const currentItem = $('loadCurrentItem');
  const activeList = $('loadActiveList');
  const errorBox = $('loadErrorBox');
  let progressFadeTimer = null;

  function handlePreloadProgress({ loaded, total, percent, item, isStarting, isOk, error, activeTasks, failedItems, finished }) {
    if (!progressWidget) return;
    if (progressFadeTimer) clearTimeout(progressFadeTimer);

    progressWidget.style.display = 'flex';
    progressWidget.style.opacity = '1';

    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressCount) progressCount.textContent = `${loaded}/${total} (${percent}%)`;

    if (currentItem) {
      if (isStarting) {
        currentItem.textContent = `⏳ [Đang nạp] ${item}`;
        currentItem.style.color = '#ffd54f';
      } else if (isOk) {
        currentItem.textContent = `✅ [Xong] ${item}`;
        currentItem.style.color = '#a5d6a7';
      } else {
        currentItem.textContent = `❌ [Lỗi] ${item}: ${error || 'Lỗi nạp'}`;
        currentItem.style.color = '#ff5252';
      }
    }

    if (activeList) {
      if (activeTasks && activeTasks.length > 0) {
        activeList.style.display = 'flex';
        activeList.innerHTML = activeTasks.map(t => {
          const isSlow = Number(t.elapsed) >= 8.0;
          const detailBadge = t.detail ? `<span style="background:rgba(0,229,255,0.18);border:1px solid #00e5ff;color:#00e5ff;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;margin-left:8px;">${t.detail}</span>` : '';
          return `<div class="load-active-item ${isSlow ? 'slow' : ''}"><span>⏳ ${t.name}${detailBadge}</span><span style="font-weight:800;color:${isSlow ? '#ffb74d' : '#80d8ff'}">${t.elapsed}s${isSlow ? ' ⚠️' : ''}</span></div>`;
        }).join('');
      } else {
        activeList.style.display = 'none';
        activeList.innerHTML = '';
      }
    }

    if (errorBox) {
      if (failedItems && failedItems.length > 0) {
        errorBox.style.display = 'block';
        errorBox.innerHTML = `<strong>⚠️ ${failedItems.length} tài nguyên bị lỗi:</strong><br/>` +
          failedItems.map((f) => `• ${f.name}: ${f.error || 'không tìm thấy'}`).join('<br/>');
      } else {
        errorBox.style.display = 'none';
      }
    }

    if (finished) {
      if (activeList) activeList.style.display = 'none';
      if (!failedItems || failedItems.length === 0) {
        if (progressTitle) progressTitle.textContent = '✅ Đã tải xong toàn bộ tài nguyên!';
        if (currentItem) currentItem.textContent = 'Sẵn sàng phát hoạt ảnh';
        progressFadeTimer = setTimeout(() => {
          progressWidget.style.opacity = '0';
          setTimeout(() => {
            progressWidget.style.display = 'none';
          }, 300);
        }, 1600);
      } else {
        if (progressTitle) progressTitle.textContent = `⚠️ Đã tải xong (có ${failedItems.length} lỗi)`;
      }
    } else {
      if (progressTitle) progressTitle.textContent = `⏳ Đang tải tài nguyên (${loaded}/${total})...`;
    }
  }

  runner = new ActionBankRunner({
    log,
    lwf,
    usm,
    chara,
    bg,
    screenFade,
    audio,
    koOverlay: $('koOverlay'),
    hud: $('hud'),
    statusEl: statusBar,
    onPreloadProgress: handlePreloadProgress,
    onStatus: (kind, r) => {
      if (kind === 'playing') {
        setTransport({ ready: true, playing: true, paused: false });
      } else if (kind === 'paused') {
        setTransport({ ready: true, playing: true, paused: true });
        if (statusBar) statusBar.textContent = `Paused · frame ${r.frame}/${r.maxFrame}`;
      } else if (kind === 'ready') {
        setTransport({ ready: true, playing: false, paused: false });
        if (statusBar) statusBar.textContent = `Ready · ${r.commands.length} cmds · end=${r.maxFrame}`;
      } else if (kind === 'reset') {
        setTransport({ ready: false, playing: false, paused: false });
      } else if (kind === 'preloaded') {
        if (statusBar) statusBar.textContent = `Preloaded · baking…`;
      } else if (kind === 'stopped' || kind === 'done') {
        setTransport({
          ready: Boolean(r.ready && r.commands?.length),
          playing: false,
          paused: false,
        });
        if (statusBar) statusBar.textContent = `${kind} · frame ${r.frame}/${r.maxFrame}`;
      } else if (kind !== 'playing') {
        if (statusBar) statusBar.textContent = `${kind} · frame ${r.frame}/${r.maxFrame} · state ${r.state}`;
      }
      if (kind === 'done' && $('loopBank')?.checked && !recorder?.recording) {
        log('Loop bank → Play');
        // The runner itself already freezes the final K.O. frame for two
        // seconds; replay immediately after that hold completes.
        setTimeout(() => {
          if (isInViewport && isTabVisible && isHostVisible) {
            runner.play();
          } else {
            isViewportPaused = true;
          }
        }, r.koPreviewEnabled && r._hasCustomKoEffect ? 50 : 250);
      }
    },
    onDone: () => {
      setTransport({
        ready: Boolean(runner.ready && runner.commands?.length),
        playing: false,
        paused: false,
      });
      if (recorder?.recording) {
        return finishRecordingTake({ promptSave: true });
      }
      return undefined;
    },
  });

  refMode = new ReferenceMode({
    stageEl: stage,
    overlayEl: $('overlayCanvas'),
    chara,
    runner,
    usm,
    lwf,
    log,
  });
  refMode.bindUi();
} catch (e) {
  initError = e;
  console.error('LUA player init failed', e);
  const msg = `Init failed: ${e?.message || e}`;
  try {
    log(msg);
    if (e?.stack) log(String(e.stack).split('\n').slice(0, 6).join(' | '));
  } catch {

  }
  const hint = $('scriptListHint');
  if (hint) hint.textContent = msg;
  if (statusBar) statusBar.textContent = msg;
}

function defaultExportName() {
  const name = ($('scriptPath').value.split('/').pop() || 'preview').replace(/\.lua$/i, '');
  const ext = recorder.defaultExt?.() || 'webm';
  return `${name}-actionbank.${ext}`;
}

async function finishRecordingTake({ promptSave = true } = {}) {
  if (!recorder.recording && !recorder.blob) return null;
  runner.onRecordFrame = null;
  $('btnRecord').disabled = true;
  try {
    if (recorder.recording) await recorder.stop();
    $('btnRecord').textContent = 'Record';
    $('btnExport').disabled = !recorder.blob;
    if (promptSave && recorder.blob) {
      await recorder.saveWithPrompt(defaultExportName());
    }
    return recorder.blob;
  } finally {
    setTransport({
      ready: Boolean(runner.ready && runner.commands?.length),
      playing: runner.playing,
      paused: runner.userPaused,
    });
    $('btnRecord').disabled = !runner.ready;
    $('btnExport').disabled = !recorder.blob;
  }
}

function refreshConditions(scriptText) {
  const used = detectUsedConditions(scriptText || '');
  mountConditionList($('conditionList'), {
    used,
    values: conditionValues,
    onChange: () => {
      scheduleConditionRebind();
    },
  });
  const hint = $('conditionHint');
  if (hint) {
    const cutin = cutinHelperHint(scriptText || '');
    hint.textContent = cutin
      ? `Gray = unused. Cut-in: ${cutin}`
      : 'Condition flags for LUA, Gray = unused by this script.';
  }
}

let scriptListPollTimer = null;
let scriptListPolls = 0;

async function loadScriptList({ silent = false } = {}) {
  const hint = $('scriptListHint');
  const sel = $('scriptSelect');
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
  const url = withPatchQuery('/api/scripts');
  const t0 = performance.now();
  try {
    if (!silent && hint) hint.textContent = 'Loading script list…';
    log(`script-list GET ${url}`);
    log(
      `script-list host=${window.location.host} baseURI=${document.baseURI || '(none)'} selectEl=${Boolean(sel)}`,
    );
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
    const ms = Math.round(performance.now() - t0);
    const ct = res.headers.get('content-type') || '';
    const raw = await res.text();
    log(`script-list HTTP ${res.status} ${ms}ms ct=${ct || '(none)'} bytes=${raw.length}`);
    if (!res.ok) {
      log(`script-list body: ${raw.slice(0, 300)}`);
      throw new Error(`HTTP ${res.status}`);
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      log(`script-list JSON parse failed: ${parseErr.message || parseErr}`);
      log(`script-list body head: ${raw.slice(0, 300)}`);
      throw parseErr;
    }
    const scripts = Array.isArray(data.scripts) ? data.scripts : null;
    allScripts = scripts || [];
    log(
      `script-list keys=${Object.keys(data || {}).join(',')}` +
        ` countField=${data.count}` +
        ` scriptsArray=${scripts ? scripts.length : 'NOT_ARRAY'}` +
        ` building=${data.building}` +
        ` stale=${data.stale}` +
        ` error=${data.error ?? '(none)'}` +
        ` base=${data.base ?? '(none)'}`,
    );
    if (allScripts[0]?.path) log(`script-list sample0=${allScripts[0].path}`);
    if (allScripts.length > 1) log(`script-list sampleN=${allScripts[allScripts.length - 1].path}`);
    if (data.diag) log(`script-list diag=${JSON.stringify(data.diag)}`);

    const savedPath = $('scriptPath')?.value.trim() || '';
    fillScriptSelect($('scriptFilter')?.value || '');
    if (savedPath) {
      $('scriptPath').value = savedPath;
      syncSelectToPath(savedPath);
    } else if (allScripts.length && !$('scriptPath').value.trim()) {
      if (sel) {
        sel.selectedIndex = 0;
        $('scriptPath').value = sel.value;
      }
    }
    log(
      `script-list afterFill options=${sel ? sel.options.length : 'NO_SELECT'}` +
        ` path=${$('scriptPath')?.value || '(empty)'}`,
    );

    const extra = data.building ? ' (indexing…)' : data.stale ? ' (cached)' : '';
    if (hint) {
      if (allScripts.length) {
        hint.textContent = `${allScripts.length} scripts loaded${extra}`;
      } else if (data.building) {
        hint.textContent = 'Indexing lua/ab_script…';
      } else if (data.error) {
        hint.textContent = `Script list empty: ${data.error}`;
      } else {
        hint.textContent = `No scripts (HTTP ok, array=${scripts ? scripts.length : 'missing'})`;
      }
    }
    if (scriptListPollTimer) {
      clearTimeout(scriptListPollTimer);
      scriptListPollTimer = null;
    }
    if (data.building && !allScripts.length && scriptListPolls < 10) {
      scriptListPolls += 1;
      scriptListPollTimer = setTimeout(() => {
        scriptListPollTimer = null;
        void loadScriptList({ silent: true });
      }, 2000);
    } else {
      scriptListPolls = 0;
    }
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    const msg = aborted ? `aborted after ${Math.round(performance.now() - t0)}ms` : e.message || e;
    log(`script-list FAIL: ${msg}`);
    if (e?.stack) log(`script-list stack: ${String(e.stack).split('\n').slice(0, 4).join(' | ')}`);
    if (hint) hint.textContent = `Script list failed: ${msg}`;
    if (scriptListPollTimer) clearTimeout(scriptListPollTimer);
    scriptListPollTimer = null;
    scriptListPolls = 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveScriptText(path, forceFresh = false) {
  const norm = normalizeScriptPath(path);
  if (!forceFresh && openedScript?.text && normalizeScriptPath(openedScript.path) === norm) {
    return { text: openedScript.text, path: openedScript.path, source: 'open' };
  }
  const freshParam = forceFresh ? `&_t=${Date.now()}&force=1` : '';
  const res = await fetchFresh(withPatchQuery(`/api/script?path=${encodeURIComponent(path)}${freshParam}`));
  const raw = await res.text();
  let text = raw;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data.text === 'string') {
      text = data.text;
    }
  } catch {
    text = raw;
  }
  return { text, path, source: 'server' };
}

function applyGlobals(host) {
  for (const def of CONDITION_DEFS) {
    host.setGlobalNumber(def.key, conditionValues[def.key] ?? def.default);
  }
  const { attackerId, enemyId } = readCardIds();
  host.setGlobalNumber('_SPECIAL_ENERGY_COLOR_', 0);
  const skillLv = Number(conditionValues._SPECIAL_SKILL_LEVEL_);
  host.setGlobalNumber(
    '_SPECIAL_SKILL_LEVEL_',
    Number.isFinite(skillLv) ? skillLv : 0,
  );
  host.setGlobalNumber('_ATTACKER_CARD_ID_', attackerId);
  host.setGlobalNumber('_DEFENDER_CARD_ID_', enemyId);
  host.setGlobalNumber('_COSTUME_CARD_ID_', 0);
}

async function rebindWithConditions({ quiet = false } = {}) {
  if (!loadedSession?.scriptText) {
    if (!quiet) log('Load a script first — then toggle conditions and Play');
    return false;
  }
  if (runner.playing || runner.userPaused) {
    runner.stop({ clearVisuals: false, silent: true });
  }
  setTransport({ ready: false, playing: false, paused: false });
  runner.resetForRebind();

  const path = loadedSession.path;
  runner.reactionPreview = isReactionScriptPath(path);
  if (runner.reactionPreview) {
    conditionValues._IS_DEAD_ = 0;
    conditionValues._IS_DEAD_LAST_ = 0;
  }
  await ensureFengari();
  const host = createLuaHost();
  installBinders(host, runner);
  applyGlobals(host);
  host.run(
    'OFFSET_X = OFFSET_X or 0; OFFSET_Y = OFFSET_Y or 0; fcolor_r = fcolor_r or 245; fcolor_g = fcolor_g or 245; fcolor_b = fcolor_b or 245;',
    'prelude',
  );
  if (loadedSession.commonText) {
    host.run(loadedSession.commonText, 'ab_script/common/common.lua');
  }
  host.run(loadedSession.scriptText, path);

  runner.setEnemySide(Number(conditionValues._IS_PLAYER_SIDE_) === 0);
  runner.setHighSpeed($('highSpeed').checked);
  runner.setMovieMode(Boolean($('movieMode')?.checked));
  runner.koPreviewEnabled = !runner.reactionPreview && Number(conditionValues._IS_DEAD_LAST_) === 1;
  runner.prepare();

  const skipOn = Number(conditionValues._IS_SKIP_) === 1;
  log(
    `Conditions updated → ${runner.commands.length} cmds` +
      ` · _IS_SKIP_=${skipOn ? 1 : 0}` +
      (quiet ? ' (quiet)' : ''),
  );
  statusBar.textContent = 'Warming new branches…';
  runner.audio?._ensureCtx?.();
  runner.audio?.resume?.();
  await runner.preload();

  setTransport({ ready: true, playing: false, paused: false });
  statusBar.textContent = `Ready · ${runner.commands.length} cmds · end=${runner.maxFrame}`;
  saveSettings();
  return true;
}

function scheduleConditionRebind() {
  if (!loadedSession?.scriptText) return;
  if (rebindTimer) clearTimeout(rebindTimer);
  rebindTimer = setTimeout(() => {
    rebindTimer = null;
    rebindInFlight = rebindWithConditions({ quiet: true }).catch((e) => {
      log(`Condition rebind: ${e.message || e}`);
      statusBar.textContent = 'Condition rebind failed';
      setTransport({ ready: false, playing: false, paused: false });
    });
  }, 80);
}

async function loadAndBind({ forceFresh = false } = {}) {
  const path = $('scriptPath').value.trim();
  if (!path) {
    log('Enter a script path');
    return;
  }

  runner.reactionPreview = isReactionScriptPath(path);
  if (runner.reactionPreview) {
    conditionValues._IS_DEAD_ = 0;
    conditionValues._IS_DEAD_LAST_ = 0;
  }

  setTransport({ ready: false, playing: false, paused: false });
  $('btnLoad').disabled = true;
  loadedSession = null;
  runner.resetTimeline();

  try {
    statusBar.textContent = 'Đang tải script…';
    const script = await resolveScriptText(path, forceFresh);
    if (script.source === 'open') log(`Using opened file (${openedScript?.name || path})`);

    // Auto-detect Card ID from script header only if not already provided
    const currentCardVal = Number($('attackerCardId')?.value) || 0;
    if (!currentCardVal) {
      const cardMatch = script.text.match(/^--\s*(\d{7}):/m);
      if (cardMatch && cardMatch[1]) {
        const autoId = Number(cardMatch[1]);
        if (autoId && $('attackerCardId')) {
          $('attackerCardId').value = autoId;
          log(`Tự động khớp Thẻ nhân vật: ${autoId}`);
        }
      }
    }

    statusBar.textContent = 'Đang nạp dữ liệu thẻ…';
    const cards = await resolveCards();
    runner.setCards(cards);

    const bgId = Number($('levelBgId')?.value) || 1;
    const fieldId = Number($('dokkanFieldId')?.value) || 0;
    statusBar.textContent = 'Đang nạp đấu trường…';
    await runner.setBattleBg(bgId);
    if (fieldId) await runner.setDokkanField(fieldId);

    refreshConditions(script.text);
    if (script.text.includes('_IS_PLAYER_SIDE_') && conditionValues._IS_PLAYER_SIDE_ === undefined) {
      conditionValues._IS_PLAYER_SIDE_ = 1;
    }

    let commonText = null;
    const commonPath = 'ab_script/common/common.lua';
    if (!path.replace(/\\/g, '/').endsWith('common/common.lua')) {
      const freshParam = forceFresh ? `&_t=${Date.now()}&force=1` : '';
      const commonRes = await fetchFresh(
        withPatchQuery(`/api/script?path=${encodeURIComponent(commonPath)}${freshParam}`)
      );
      const rawCommon = await commonRes.text();
      try {
        const commonData = JSON.parse(rawCommon);
        commonText = (commonData && typeof commonData.text === 'string') ? commonData.text : rawCommon;
      } catch {
        commonText = rawCommon;
      }
      log(`Running ${commonPath}…`);
    }

    await ensureFengari();
    const host = createLuaHost();
    installBinders(host, runner);
    applyGlobals(host);

    host.run(
      'OFFSET_X = OFFSET_X or 0; OFFSET_Y = OFFSET_Y or 0; fcolor_r = fcolor_r or 245; fcolor_g = fcolor_g or 245; fcolor_b = fcolor_b or 245;',
      'prelude',
    );
    if (commonText) host.run(commonText, commonPath);
    log(`Running ${path}…`);
    host.run(script.text, path);
    saveSettings();

    loadedSession = {
      path,
      scriptText: script.text,
      commonText,
    };

    runner.setTurboLite(Boolean($('turboLite')?.checked));
    runner.setEnemySide(Number(conditionValues._IS_PLAYER_SIDE_) === 0);
    runner.setHighSpeed($('highSpeed').checked);
    runner.setMovieMode(Boolean($('movieMode')?.checked));
    runner.koPreviewEnabled = !runner.reactionPreview && Number(conditionValues._IS_DEAD_LAST_) === 1;
    runner.prepare();

    log(`Chuẩn bị: ${runner.commands.length} lệnh · Nạp tài nguyên…`);
    statusBar.textContent = 'Nạp tài nguyên…';
    runner.audio?._ensureCtx?.();
    runner.audio?.resume?.();
    await runner.preload();

    setTransport({ ready: true, playing: false, paused: false });
    statusBar.textContent = `✅ Đã nạp xong 100%! · ${runner.commands.length} lệnh · Frame=${runner.maxFrame}`;
    setTimeout(() => {
      if (!runner.playing && runner.ready) {
        if (isInViewport && isTabVisible && isHostVisible) {
          $('btnPlay')?.click();
        } else {
          isViewportPaused = true;
        }
      }
    }, 200);

    const fx = runner.commands.filter((c) => c.type === 'entryEffect');
    const se = runner.commands.filter((c) => c.type === 'playSe' || c.type === 'playSeVer2');
    const mv = runner.commands.filter((c) => c.type === 'setupMovie');
    const vo = runner.commands.filter((c) => c.type === 'playVoice');
    log(`  effects=${fx.length} se=${se.length} voice=${vo.length} movies=${mv.length}`);
    for (const e of fx.slice(0, 12)) {
      log(`  FX id=${e.effectId} attr=0x${(Number(e.attr) >>> 0).toString(16)} @f${e.frame}`);
    }
  } finally {
    $('btnLoad').disabled = false;
  }
}

$('btnLoad')?.addEventListener('click', () => {
  loadAndBind().catch((e) => {
    log(`Load error: ${e.message || e}`);
    statusBar.textContent = 'Load failed';
    if (progressWidget) {
      progressWidget.style.display = 'flex';
      if (progressTitle) progressTitle.textContent = '❌ Lỗi nạp hoạt ảnh';
      if (currentItem) currentItem.textContent = e.message || String(e);
    }
    setTransport({ ready: false, playing: false, paused: false });
  });
});

$('scriptSelect')?.addEventListener('change', () => {
  openedScript = null;
  $('scriptPath').value = $('scriptSelect').value;
  onScriptPathPicked();
  saveSettings();
});

$('scriptPath')?.addEventListener('input', () => {
  const p = $('scriptPath').value.trim();
  if (openedScript && normalizeScriptPath(openedScript.path) !== normalizeScriptPath(p)) {
    openedScript = null;
  }
  syncSelectToPath(p);
  onScriptPathPicked();
});

$('scriptFilter')?.addEventListener('input', () => {
  fillScriptSelect($('scriptFilter').value);
});

async function openLuaFile(file) {
  if (!file) return;
  const text = await file.text();
  const name = file.name || 'script.lua';
  const matched = matchScriptPath(name, file.webkitRelativePath || name);
  const path = matched || `local/${name}`;
  openedScript = { path, text, name };
  $('scriptPath').value = path;
  syncSelectToPath(path);
  saveSettings();
  log(`Opened ${name}${matched ? ` → ${matched}` : ' (local preview)'}`);
  await loadAndBind();
}

$('btnOpenScript')?.addEventListener('click', (ev) => {
  ev.preventDefault();
  const input = $('scriptFile');
  if (!input) return;
  input.value = '';
  input.click();
});

$('scriptFile')?.addEventListener('change', async () => {
  const input = $('scriptFile');
  const file = input?.files?.[0];
  if (!file) return;
  try {
    await openLuaFile(file);
  } catch (e) {
    log(`Open failed: ${e.message || e}`);
    statusBar.textContent = 'Open failed';
  } finally {
    input.value = '';
  }
});

$('btnPlay')?.addEventListener('click', async () => {
  const resuming = !!(runner.playing && runner.userPaused);
  refMode?.discardVisualOverrides?.({
    snap: !resuming,
    restoreEntry: !!refMode?.active || !!refMode?._entrySnapshot,
  });
  if (transportBusy) return;
  if (resuming) {
    await runner.resume();
    return;
  }
  transportBusy = true;
  try {

    if (rebindTimer) {
      clearTimeout(rebindTimer);
      rebindTimer = null;
      try {
        await rebindWithConditions({ quiet: true });
      } catch (e) {
        log(`Condition rebind: ${e.message || e}`);
        return;
      }
    } else if (rebindInFlight) {
      try {
        await rebindInFlight;
      } catch {
        return;
      }
    }

    if (runner.playing) {
      runner.stop({ clearVisuals: false, silent: true });
    }
    runner.audio?._ensureCtx?.();
    runner.audio?.resume?.();
    runner.setHighSpeed($('highSpeed').checked);
    runner.setMovieMode(Boolean($('movieMode')?.checked));
    runner.setEnemySide(Number(conditionValues._IS_PLAYER_SIDE_) === 0);
    if (!runner.play()) {
      setTransport({
        ready: Boolean(runner.ready && runner.commands?.length),
        playing: false,
        paused: false,
      });
    }
  } finally {
    transportBusy = false;
  }
});

$('btnPause')?.addEventListener('click', () => {
  runner.pause();
});

$('btnStop')?.addEventListener('click', async () => {
  if (transportBusy) return;
  transportBusy = true;
  try {
    const wasRecording = recorder.recording;

    runner.stop({
      clearVisuals: false,
      silent: true,
      silenceAudio: !wasRecording,
    });
    setTransport({
      ready: Boolean(runner.ready && runner.commands?.length),
      playing: false,
      paused: false,
    });
    statusBar.textContent = 'Stopped';
    log('Stopped playback');
    if (wasRecording) {
      await finishRecordingTake({ promptSave: true });
      runner.stop({ clearVisuals: false, silent: true, silenceAudio: true });
    }
  } finally {
    transportBusy = false;
  }
});

$('turboLite')?.addEventListener('change', () => {
  runner.setTurboLite($('turboLite').checked);
  log(`Turbo Lite ${$('turboLite').checked ? 'Bật (Siêu tốc)' : 'Tắt'}`);
});

$('highSpeed')?.addEventListener('change', () => {
  runner.setHighSpeed($('highSpeed').checked);
});

$('phoneCrop')?.addEventListener('change', () => {
  setPhoneCrop(stage, $('phoneCrop').checked);
});

$('movieMode')?.addEventListener('change', () => {
  runner?.setMovieMode?.($('movieMode').checked);
  log(`Movie Mode ${$('movieMode').checked ? 'on' : 'off'}`);
});

$('btnRecord')?.addEventListener('click', async () => {
  if (recorder.recording) {

    runner.onRecordFrame = null;
    if (runner.playing || runner.userPaused) {
      runner.stop({ clearVisuals: false, silent: true, silenceAudio: false });
    }
    await finishRecordingTake({ promptSave: true });
    audio.silence?.();
    return;
  }

  if (!runner.ready || !runner.commands?.length) {
    log('Load a script before recording');
    return;
  }

  if (runner.playing || runner.userPaused) {
    runner.stop({ clearVisuals: false, silent: true });
  }

  audio._ensureCtx();
  try {
    await audio.ctx.resume();
  } catch {

  }
  const audioStream = audio.getCaptureStream();

  for (const t of audioStream.getAudioTracks()) {
    try {
      t.enabled = true;
    } catch {

    }
  }

  try {
    await recorder.start({
      audioStream,
      sampleRate: audio.ctx?.sampleRate || 48000,
      audioBus: audio,
    });
  } catch (e) {
    log(`Record failed to start: ${e.message || e}`);
    return;
  }
  runner.onRecordFrame = (steps) => recorder.captureFrame(steps);
  $('btnRecord').textContent = 'Stop rec';
  $('btnExport').disabled = true;

  if (!runner.play()) {
    log('Record: Play failed — stopping recorder');
    runner.onRecordFrame = null;
    await finishRecordingTake({ promptSave: false });
  }
});

$('btnExport')?.addEventListener('click', async () => {
  await recorder.saveWithPrompt(defaultExportName());
});

$('btnSplitSheets')?.addEventListener('click', async () => {
  const btn = $('btnSplitSheets');
  btn.disabled = true;
  try {
    log('Split sheets: collecting loaded LWF packs…');
    const packs = await collectSheetExportPacks();
    if (!packs.length) {
      log('Split sheets: no loaded LWF packs — Load a script first');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const zipName = `ab-lwf-sheets-${stamp}.zip`;
    const withXform = !!$('exportTransforms')?.checked;
    const keepPad = !!$('keepAtlasPadding')?.checked;
    log(
      `Split sheets: exporting ${packs.length} pack(s)` +
        (withXform ? ' (+ transforms)' : ' (images only)') +
        (keepPad ? ' · raw UV pads' : ' · cleaned slices') +
        '…',
    );
    const { blob, fileCount, imageCount, transformCount } = await exportSheetsZip(
      packs,
      zipName,
    );
    downloadBlob(blob, zipName);
    log(
      `Split sheets done · ${packs.length} packs · ${imageCount || 0} images` +
        (withXform ? ` · ${transformCount || 0} xforms` : '') +
        ` · ${fileCount} files → ${zipName}`,
    );
  } catch (e) {
    log(`Split sheets failed: ${e.message || e}`);
  } finally {
    btn.disabled = !runner.ready;
  }
});

$('btnCopyLog')?.addEventListener('click', async () => {
  const text = logEl?.textContent || '';
  if (!text.trim()) {
    log('Log is empty');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    statusBar.textContent = 'Log copied';
    log('Copied log to clipboard');
  } catch (e) {

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      statusBar.textContent = 'Log copied';
      log('Copied log to clipboard');
    } catch (e2) {
      log(`Copy failed: ${e.message || e}`);
    }
  }
});

$('btnClearLog')?.addEventListener('click', () => {
  if (logEl) logEl.textContent = '';
});

function scriptPathFromQuery(raw) {
  const p = normalizeScriptPath(raw);
  if (!p) return '';
  if (p.startsWith('ab_script/')) return p;
  const idx = p.indexOf('lua/ab_script/');
  if (idx >= 0) return p.slice(idx + 'lua/'.length);
  if (p.startsWith('lua/')) return p.slice(4);
  if (p.includes('ab_script/')) return p.slice(p.indexOf('ab_script/'));
  if (p.toLowerCase().endsWith('.lua')) return `ab_script/${p.split('/').pop()}`;
  return p;
}

async function boot() {
  try {
    if (initError) {
      log(`Init blocked boot: ${initError.message || initError}`);
      return;
    }
    if (!stage || !runner) {
      const msg = 'Init incomplete — stage/runner missing';
      log(msg);
      if (statusBar) statusBar.textContent = msg;
      return;
    }
    initStage(stage);
    watchStageFit(stage);
    const saved = loadSettings();
    applySettings(saved);
    if ($('highSpeed')) $('highSpeed').checked = false;
    runner?.setHighSpeed?.(false);
    miniFast = false;
    if ($('miniSpeedText')) $('miniSpeedText').textContent = '1x';
    setPhoneCrop(stage, $('phoneCrop')?.checked);
    if ($('movieMode')) $('movieMode').checked = false;
    runner?.setMovieMode?.(false);
    bindSettingsPersistence();
    refreshConditions('');
    setTransport({ ready: false, playing: false, paused: false });

    const params = new URLSearchParams(window.location.search);
    const queryServerPort = Number(params.get('server_port') || params.get('serverPort'));
    if (queryServerPort > 0) window.__SERVER_PORT__ = queryServerPort;
    const queryCardId = Number(params.get('card') || params.get('card_id'));
    if (queryCardId > 0 && $('attackerCardId')) $('attackerCardId').value = queryCardId;
    if (params.get('compact') === '1') {
      document.body.classList.add('compact-mode');
      if ($('turboLite')) $('turboLite').checked = true;
      runner?.setTurboLite?.(true);
    }
    const queryPatch = (params.get('patch') || '').trim();
    if (queryPatch && queryPatch !== '0') {
      setActivePatchId(queryPatch);
      log(`Active patch ${queryPatch}`);
    }
    const queryScript = scriptPathFromQuery(params.get('script') || params.get('path') || '');

    try {
      const h = await fetch(withPatchQuery('/api/health')).then((r) => r.json());
      if (h?.source === 'website-uncompressed') {
        log(
          `Website assets ${h.assetExists ? 'ok' : 'missing'} · db ${h.dbExists ? 'ok' : 'missing'}` +
            (h.scriptsBaseExists === false
              ? ' · lua/ab_script missing'
              : typeof h.scriptsCached === 'number'
                ? ` · scripts cache ${h.scriptsCached}`
                : ''),
        );
      } else {
        log(
          `Server ok - assets ${h.assetExists ? 'ok' : 'missing'} - db ${h.dbExists ? 'ok' : 'missing'}`,
        );
      }
      if (!h.assetExists) log(`Asset root missing: ${h.assetRoot}`);
      if (!h.dbExists) log(`DB missing: ${h.dbPath}`);
      if (h.scriptsBaseExists === false) log(`Scripts base missing under ${h.assetRoot}`);
    } catch (e) {
      if (window.__ECLIPSE_TOOL__ === 'lua-player') {
        log('Site UI ready — open a .lua from File Browser, or run tools/ab-lua-player/serve.bat locally.');
      } else {
        log(`Health check failed: ${e.message || e}`);
      }
    }
    void loadScriptList().then(async () => {
      if (window.__PENDING_ARGS__) {
        const p = window.__PENDING_ARGS__;
        window.__PENDING_ARGS__ = null;
        if (typeof window.__DOKKAN_LOAD__ === 'function') {
          void window.__DOKKAN_LOAD__(p.card_id, p.script_path, p);
          return;
        }
      }
      if (queryScript) {
        const p = new URLSearchParams(window.location.search);
        const qKo = (p.get("ko") === "1" || p.get("ko_preview") === "1" || p.get("ko_screen") === "1") &&
          !isReactionScriptPath(queryScript);
        conditionValues._IS_DEAD_ = qKo ? 1 : 0;
        conditionValues._IS_DEAD_LAST_ = qKo ? 1 : 0;
        if (runner) runner.koPreviewEnabled = qKo;
        const qEnemy = Number(p.get("enemy_card_id") || p.get("enemy")) || 1033701;
        if ($('enemyCardId')) $('enemyCardId').value = qEnemy;
        $('scriptPath').value = queryScript;
        syncSelectToPath(queryScript);
        log(`Opened from File Browser · ${queryScript}`);
        saveSettings();
        try {
          await loadAndBind();
        } catch (err) {
          log(`Auto-load failed: ${err.message || err}`);
        }
        return;
      }
      saveSettings();
      if (saved?.scriptPath) {
        log(`Restored settings · script ${saved.scriptPath}`);
      }
    });
  } catch (e) {
    const msg = `Boot failed: ${e.message || e}`;
    console.error(e);
    try {
      log(msg);
      if (e?.stack) log(String(e.stack).split('\n').slice(0, 6).join(' | '));
    } catch {

    }
    if (statusBar) statusBar.textContent = msg;
    const hint = $('scriptListHint');
    if (hint) hint.textContent = msg;
  }
}

// Floating glass controls for compact / inline mode
let isMuted = false;
if (audio) audio.setMuted(false);

$('btnToggleSound')?.addEventListener('click', () => {
  isMuted = !isMuted;
  if (audio) audio.setMuted(isMuted);
  if (isMuted) {
    if ($('soundIcon')) $('soundIcon').textContent = '🔇';
    if ($('soundText')) $('soundText').textContent = 'Mute';
    $('btnToggleSound')?.classList.add('active');
  } else {
    if ($('soundIcon')) $('soundIcon').textContent = '🔊';
    if ($('soundText')) $('soundText').textContent = 'Sound ON';
    $('btnToggleSound')?.classList.remove('active');
    audio?._ensureCtx?.();
    audio?.resume?.();
  }
});

let miniFast = false;
$('btnMiniSpeed')?.addEventListener('click', () => {
  miniFast = !miniFast;
  runner.setHighSpeed(miniFast);
  if ($('miniSpeedText')) $('miniSpeedText').textContent = miniFast ? '2x' : '1x';
  if ($('highSpeed')) $('highSpeed').checked = miniFast;
});

let currentVoiceLang = window.__VOICE_LANGUAGE__ || 'ja';

function updateVoiceLanguageUI(lang) {
  currentVoiceLang = (lang === 'en') ? 'en' : 'ja';
  window.__VOICE_LANGUAGE__ = currentVoiceLang;
  if (audio?.setVoiceLanguage) {
    audio.setVoiceLanguage(currentVoiceLang);
  }
  if ($('voiceLangIcon')) $('voiceLangIcon').textContent = currentVoiceLang === 'ja' ? '🇯🇵' : '🇺🇸';
  if ($('voiceLangText')) $('voiceLangText').textContent = currentVoiceLang === 'ja' ? 'JP Voice' : 'EN Voice';
  if ($('voiceLangSelect')) $('voiceLangSelect').value = currentVoiceLang;
}

async function switchVoiceLanguage(lang) {
  updateVoiceLanguageUI(lang);
  if (audio?.clearVoiceCache) audio.clearVoiceCache();
  if (runner?.preloadVoiceCues) {
    if (statusBar) statusBar.textContent = `⏳ Đang nạp Voice (${lang === 'ja' ? 'Tiếng Nhật 🇯🇵' : 'Tiếng Anh 🇺🇸'})...`;
    try {
      await runner.preloadVoiceCues();
      if (statusBar) statusBar.textContent = `✅ Đã chuyển Voice sang ${lang === 'ja' ? 'Tiếng Nhật 🇯🇵' : 'Tiếng Anh 🇺🇸'}`;
    } catch (e) {
      console.warn('preloadVoiceCues:', e);
    }
  }
  if (runner && runner.ready) {
    if (isMuted) {
      isMuted = false;
      if (audio) audio.setMuted(false);
      if ($('soundIcon')) $('soundIcon').textContent = '🔊';
      if ($('soundText')) $('soundText').textContent = 'Sound ON';
      $('btnToggleSound')?.classList.remove('active');
    }
    runner.stop({ silenceAudio: true });
    runner.audio?._ensureCtx?.();
    runner.audio?.resume?.();
    runner.play();
    if ($('miniPlayIcon')) $('miniPlayIcon').textContent = '⏸️';
    if ($('miniPlayText')) $('miniPlayText').textContent = 'Pause';
  }
}

window.__DOKKAN_SET_VOICE_LANG__ = (lang) => {
  void switchVoiceLanguage(lang);
};

$('btnVoiceLang')?.addEventListener('click', () => {
  const nextLang = currentVoiceLang === 'ja' ? 'en' : 'ja';
  void switchVoiceLanguage(nextLang);
});

$('voiceLangSelect')?.addEventListener('change', (e) => {
  void switchVoiceLanguage(e.target.value);
});

// Smart Viewport & Tab Visibility Manager (Auto-pause when scrolled away or tab hidden, auto-resume when visible)
let isInViewport = true;
let isTabVisible = !document.hidden;
let isHostVisible = true;
let isViewportPaused = false;

function updateViewportPlayback() {
  if (!runner) return;
  const isVisible = isInViewport && isTabVisible && isHostVisible;

  if (isVisible) {
    if (!runner.ready) return;
    if (isViewportPaused && runner.playing && runner.userPaused) {
      isViewportPaused = false;
      void runner.resume();
      if ($('miniPlayIcon')) $('miniPlayIcon').textContent = '⏸️';
      if ($('miniPlayText')) $('miniPlayText').textContent = 'Pause';
    } else if (isViewportPaused && !runner.playing && runner.ready) {
      // If the tab was hidden while preload was still running, playback has
      // never started, so resume() cannot do anything. Start it normally now.
      isViewportPaused = false;
      $('btnPlay')?.click();
    }
    try {
      runner.lwf?.renderOnly?.();
      runner.chara?.renderOnly?.();
      runner.bg?.lwf?.renderOnly?.();
      runner._paintHud?.();
    } catch {}
  } else {
    runner.audio?.suspend?.();
    runner.usm?.setAbPause?.(true);
    runner.usm?.setSyncPause?.(true);
    runner.lwf?.setSyncPause?.(true);
    runner.chara?.setSyncPause?.(true);
    if (runner.playing && !runner.userPaused) {
      isViewportPaused = true;
      runner.pause();
      if ($('miniPlayIcon')) $('miniPlayIcon').textContent = '▶️';
      if ($('miniPlayText')) $('miniPlayText').textContent = 'Play';
    }
  }
}

$('btnMiniPlay')?.addEventListener('click', () => {
  if (runner.playing && !runner.userPaused) {
    isViewportPaused = false;
    runner.pause();
    if ($('miniPlayIcon')) $('miniPlayIcon').textContent = '▶️';
    if ($('miniPlayText')) $('miniPlayText').textContent = 'Play';
  } else {
    isViewportPaused = false;
    runner.audio?._ensureCtx?.();
    runner.audio?.resume?.();
    if (runner.userPaused) {
      void runner.resume();
    } else {
      runner.play();
    }
    if ($('miniPlayIcon')) $('miniPlayIcon').textContent = '⏸️';
    if ($('miniPlayText')) $('miniPlayText').textContent = 'Pause';
  }
});

$('btnMiniRepair')?.addEventListener('click', async () => {
  const btn = $('btnMiniRepair');
  const icon = $('miniRepairIcon');
  const txt = $('miniRepairText');
  if (btn) btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (txt) txt.textContent = 'Fixing…';
  if (statusBar) statusBar.textContent = '🔧 Đang xóa sạch cache ổ đĩa và tải đè mới từ CDN…';
  log('🔧 Force Repair: purging server disk cache & redownloading assets fresh from CDN');

  try {
    clearCardCache();
    clearEffectPackCache();
    runner.stop({ clearVisuals: true });

    const cardId = $('attackerCardId')?.value || '';
    const scriptPath = $('scriptPath')?.value || '';

    // 1. Purge server-side disk files through the asset server
    const repairQs = new URLSearchParams({ id: cardId, script: scriptPath, t: String(Date.now()) });
    await fetchFresh(`/api/repair-card?${repairQs}`).catch(() => {});

    // 2. Reload fresh with cache buster
    await loadAndBind({ forceFresh: true });
    if (statusBar) statusBar.textContent = '✅ Đã xóa sạch cache và tải đè thành công!';
    log('✅ Repair completed successfully!');
  } catch (err) {
    if (statusBar) statusBar.textContent = `❌ Lỗi sửa: ${err.message || err}`;
    log(`Repair error: ${err.message || err}`);
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.textContent = '🔧';
    if (txt) txt.textContent = 'Repair';
  }
});

if (typeof IntersectionObserver !== 'undefined') {
  const vObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (isTabVisible) {
          isInViewport = entry.isIntersecting && entry.intersectionRatio > 0.02;
          updateViewportPlayback();
        }
      }
    },
    { threshold: [0, 0.02, 0.1, 0.5] },
  );
  vObserver.observe(document.documentElement);
}

document.addEventListener('visibilitychange', () => {
  isTabVisible = !document.hidden;
  if (isTabVisible) {
    isInViewport = true;
  }
  updateViewportPlayback();
});

// Streamlit keeps every tab iframe mounted. The bridge in index.html reports
// whether this iframe's parent tab is actually visible so hidden animations do
// not continue consuming LWF/USM decoding and canvas time.
window.addEventListener('dokkan-host-visibility', (event) => {
  isHostVisible = event?.detail?.visible !== false;
  // An iframe hidden by a Streamlit tab can leave its internal observer at
  // intersectionRatio=0. The host becoming visible is authoritative.
  if (isHostVisible) isInViewport = true;
  updateViewportPlayback();
});

function isReactionScriptPath(path) {
  return /^ab_script\/(?:attack_counter\/c\d+|ab_sys\/as\d+)\.lua$/i
    .test(String(path || '').replace(/\\/g, '/').replace(/^\/+/, ''));
}

window.__DOKKAN_SET_KO__ = function (enabled) {
  const koPreview = Boolean(enabled) && !isReactionScriptPath($('scriptPath')?.value);
  conditionValues._IS_DEAD_ = koPreview ? 1 : 0;
  conditionValues._IS_DEAD_LAST_ = koPreview ? 1 : 0;
  if (runner) {
    runner.koPreviewEnabled = koPreview;
  }
};

window.__DOKKAN_SEEK_FRAME__ = async function (frame, playAfterSeek = false) {
  if (!runner) return;
  if (runner.playing && !runner.userPaused) runner.pause();
  await runner.scrubToFrame(frame);
  if (playAfterSeek) runner.play();
  runner._notifyParentFrame?.();
};

window.__DOKKAN_PLAYER_CONTROL__ = function (action) {
  if (!runner) return false;
  if (action === 'play') return runner.play();
  if (action === 'pause') return runner.pause();
  return false;
};

window.__DOKKAN_LOAD__ = async function (cardId, scriptPath, opts = {}) {
  currentLoadOptions = { ...opts };
  if (cardId && $('attackerCardId')) $('attackerCardId').value = cardId;
  if (scriptPath && $('scriptPath')) $('scriptPath').value = scriptPath;
  const enemyId = Number(opts.enemy_card_id || opts.enemyCardId) || 1033701;
  if ($('enemyCardId')) $('enemyCardId').value = enemyId;
  const koPreview = Boolean(opts.ko_preview ?? opts.koPreview ?? false) &&
    !isReactionScriptPath(scriptPath || $('scriptPath')?.value);
  // Drive both the official Lua branch and the fallback overlay from the same
  // shared switch. Explicitly clear the flags too, otherwise a previous load
  // in the same iframe can leave K.O. permanently enabled.
  conditionValues._IS_DEAD_ = koPreview ? 1 : 0;
  conditionValues._IS_DEAD_LAST_ = koPreview ? 1 : 0;
  if (runner) {
    runner.koPreviewEnabled = koPreview;
  }
  if (opts.compact || opts.inline) {
    document.body.classList.add('compact-mode');
    if ($('turboLite')) $('turboLite').checked = true;
    runner.setTurboLite(true);
  }
  const wantHighSpeed = Boolean(opts.high_speed || opts.highSpeed);
  if ($('highSpeed')) $('highSpeed').checked = wantHighSpeed;
  runner.setHighSpeed(wantHighSpeed);
  miniFast = wantHighSpeed;
  if ($('miniSpeedText')) $('miniSpeedText').textContent = wantHighSpeed ? '2x' : '1x';
  if (opts.muted !== false) {
    isMuted = true;
    if (audio) audio.setMuted(true);
    if ($('soundIcon')) $('soundIcon').textContent = '🔇';
    if ($('soundText')) $('soundText').textContent = 'Mute';
    $('btnToggleSound')?.classList.add('active');
  }
  const wantVoiceLang = opts.voice_language || opts.voiceLanguage || window.__VOICE_LANGUAGE__ || 'ja';
  updateVoiceLanguageUI(wantVoiceLang);
  try {
    // Timeline drafts reuse one preview filename. A new render revision means
    // the server-side Lua file was overwritten and must bypass the iframe's
    // opened-script/fetch cache before rebinding visuals and audio.
    await loadAndBind({ forceFresh: opts.render_revision != null && Number(opts.render_revision) > 0 });
  } catch (err) {
    log(`Load error: ${err.message || err}`);
  } finally {
    // The user may switch tabs while a large revival/USM file is still
    // loading. Re-apply host visibility once binding finishes so it cannot
    // start playing invisibly in the background.
    updateViewportPlayback();
  }
};

try {
  boot();
} catch (e) {
  console.error(e);
  const msg = `Boot throw: ${e?.message || e}`;
  const hint = document.getElementById('scriptListHint');
  if (hint) hint.textContent = msg;
  const logNode = document.getElementById('log');
  if (logNode) logNode.textContent += `${msg}\n`;
}
window.addEventListener('unhandledrejection', (ev) => {
  const msg = ev?.reason?.message || String(ev?.reason || 'unhandledrejection');
  if (
    msg.includes('no supported sources') ||
    msg.includes('interrupted by a new load request') ||
    msg.includes('interrupted by a call to pause') ||
    msg.includes('NotAllowedError') ||
    msg.includes('user agent')
  ) {
    return;
  }
  console.error(ev.reason);
  try {
    log(`Unhandled: ${msg}`);
  } catch {

  }
});
window.addEventListener('error', (ev) => {
  const msg = ev?.message || String(ev?.error || 'window.error');
  if (msg.includes('no supported sources')) return;
  try {
    log(`window.error: ${msg}`);
  } catch {

  }
});
