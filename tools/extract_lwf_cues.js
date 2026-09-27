const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Setup global window for lwf.js
global.window = global;
const lwfJsPath = path.resolve(__dirname, '../components/lua_player/vendor/lwf.js');
if (fs.existsSync(lwfJsPath)) {
  require(lwfJsPath);
} else {
  // Fallback search
  const altPath = 'F:/tool make patch/components/lua_player/vendor/lwf.js';
  if (fs.existsSync(altPath)) require(altPath);
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => {
      req.abort();
      resolve(null);
    });
  });
}

function extractLwfCuesAndFrames(rawBuffer) {
  if (!rawBuffer || rawBuffer.length < 16) {
    return { frameCount: 0, triggers: [] };
  }
  const ab = new Uint8Array(rawBuffer).buffer;
  let data;
  try {
    const loaderFunc = global.LWF?.Loader?.['z' + String.fromCharCode(36, 36) + 'c'];
    if (!loaderFunc) {
      return { frameCount: 0, triggers: [], error: 'LWF Loader not found' };
    }
    data = loaderFunc(ab);
  } catch (e) {
    return { frameCount: 0, triggers: [], error: e.message || String(e) };
  }

  if (!data || !data.movies || !data.movies.length) {
    return { frameCount: 0, triggers: [] };
  }

  // Find longest movie (the main timeline / ef_001)
  let bestMovie = data.movies[0];
  for (let i = 1; i < data.movies.length; i++) {
    if (data.movies[i].frames > bestMovie.frames) {
      bestMovie = data.movies[i];
    }
  }

  const fStart = bestMovie['z' + String.fromCharCode(36) + 'rn'];
  const fCount = bestMovie.frames;

  const eventMap = {};
  if (data.events) {
    for (let i = 0; i < data.events.length; i++) {
      const ev = data.events[i];
      const sid = ev.stringId;
      if (sid != null && data.strings && data.strings[sid]) {
        eventMap[i] = data.strings[sid];
      }
    }
  }

  const triggers = [];
  const seSeen = new Map(); // frame_cueId -> max vol
  const voSeen = new Map(); // frame_cueId -> max vol

  function processEventName(evName, f) {
    if (!evName || !evName.startsWith('sound_')) return;

    // 1. sound_se_stop_(\d+)
    let m = evName.match(/^sound_se_stop_(\d+)$/);
    if (m) {
      triggers.push({ frame: f, type: 'se_stop', cueId: parseInt(m[1], 10) });
      return;
    }

    // 2. sound_se_(\d+)_volume(\d+)
    m = evName.match(/^sound_se_(\d+)_volume(\d+)$/);
    if (m) {
      const cue = parseInt(m[1], 10);
      const vol = parseInt(m[2], 10);
      const key = `${f}_${cue}`;
      if (!seSeen.has(key) || seSeen.get(key) < vol) {
        seSeen.set(key, vol);
        triggers.push({ frame: f, type: 'se', cueId: cue, volume: vol });
      }
      return;
    }

    // 3. sound_se_(\d+)
    m = evName.match(/^sound_se_(\d+)$/);
    if (m) {
      const cue = parseInt(m[1], 10);
      triggers.push({ frame: f, type: 'se', cueId: cue, volume: -1 });
      return;
    }

    // 4. sound_voice_stop_(\d+)
    m = evName.match(/^sound_voice_stop_(\d+)$/);
    if (m) {
      triggers.push({ frame: f, type: 'voice_stop', cueId: parseInt(m[1], 10) });
      return;
    }

    // 5. sound_voice_(\d+)_volume(\d+)
    m = evName.match(/^sound_voice_(\d+)_volume(\d+)$/);
    if (m) {
      const cue = parseInt(m[1], 10);
      const vol = parseInt(m[2], 10);
      const key = `${f}_${cue}`;
      if (!voSeen.has(key) || voSeen.get(key) < vol) {
        voSeen.set(key, vol);
        triggers.push({ frame: f, type: 'voice', cueId: cue, volume: vol });
      }
      return;
    }

    // 6. sound_voice_(\d+)
    m = evName.match(/^sound_voice_(\d+)$/);
    if (m) {
      const cue = parseInt(m[1], 10);
      triggers.push({ frame: f, type: 'voice', cueId: cue, volume: -1 });
      return;
    }
  }

  const sampleCtrl = data.controls && data.controls[0];
  const kType = sampleCtrl ? Object.keys(sampleCtrl)[0] : 'z$_m';
  const kIdx = sampleCtrl ? Object.keys(sampleCtrl)[1] : 'z$0c';

  for (let f = 0; f < fCount; f++) {
    const frameObj = data.frames[fStart + f];
    if (!frameObj) continue;
    const cOff = frameObj['z' + String.fromCharCode(36) + 'jf'];
    const cCnt = frameObj.controls;
    for (let c = 0; c < cCnt; c++) {
      const ctrl = data.controls[cOff + c];
      if (!ctrl) continue;
      const ctrlType = ctrl[kType];
      const ctrlIdx = ctrl[kIdx];

      // Control type 4: Action / Animation bytecode sequence
      if (ctrlType === 4 && data.animations && data.animations[ctrlIdx]) {
        const bytecode = data.animations[ctrlIdx];
        for (let i = 0; i < bytecode.length; i++) {
          // Opcode 8: Call Event (followed by event ID)
          if (bytecode[i] === 8 && i + 1 < bytecode.length) {
            const evId = bytecode[++i];
            if (eventMap[evId]) {
              processEventName(eventMap[evId], f);
            }
          }
        }
      }
    }
  }

  // Sort triggers chronologically by frame
  triggers.sort((a, b) => a.frame - b.frame);

  return { frameCount: fCount, triggers };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(JSON.stringify({ error: 'No input provided' }));
    process.exit(1);
  }

  let buffer = null;

  // 1. If it's an existing file path
  if (fs.existsSync(arg)) {
    buffer = fs.readFileSync(arg);
  } else {
    // 2. If it's a pack_name (e.g. sp_effect_b4_00200 or battle_301300)
    const baseDir = path.resolve(__dirname, '..');
    const localCandidates = [
      path.join(baseDir, 'game res', 'effects', arg, 'en', `${arg}.lwf`),
      path.join(baseDir, 'game res', 'effects', arg, 'ja', `${arg}.lwf`),
      path.join(baseDir, 'game res', 'effects', arg, `${arg}.lwf`),
      path.join(baseDir, `${arg}.lwf`)
    ];

    for (const c of localCandidates) {
      if (fs.existsSync(c)) {
        buffer = fs.readFileSync(c);
        break;
      }
    }

    // 3. If still not found, try downloading from Dokkan Eclipse CDN
    if (!buffer) {
      const cdnUrls = [
        `https://cdn.dokkan-eclipse.com/uncompressed/ingame/battle/sp_effect/${arg}/en/${arg}.lwf`,
        `https://cdn.dokkan-eclipse.com/uncompressed/ingame/battle/effect/${arg}/en/${arg}.lwf`,
        `https://cdn.dokkan-eclipse.com/uncompressed/ingame/battle/sp_effect/${arg}/${arg}.lwf`,
        `https://cdn.dokkan-eclipse.com/uncompressed/ingame/battle/effect/${arg}/${arg}.lwf`
      ];

      for (const url of cdnUrls) {
        const fetched = await fetchBuffer(url);
        if (fetched && fetched.length > 0) {
          buffer = fetched;
          // Cache locally to game res/effects/{arg}/en/{arg}.lwf
          try {
            const savePath = path.join(baseDir, 'game res', 'effects', arg, 'en', `${arg}.lwf`);
            fs.mkdirSync(path.dirname(savePath), { recursive: true });
            fs.writeFileSync(savePath, buffer);
          } catch (e) {}
          break;
        }
      }
    }
  }

  if (!buffer) {
    console.error(JSON.stringify({ error: `Could not find or fetch LWF for: ${arg}` }));
    process.exit(1);
  }

  const result = extractLwfCuesAndFrames(buffer);
  console.log(JSON.stringify(result));
}

main();
