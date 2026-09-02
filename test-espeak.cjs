// Headless smoke test: load the EXACT vendored meSpeak files in Node,
// synthesize "En quinientos metros, gire a la derecha" in Spanish and
// check we get a valid WAV back (instance mode + rawdata, no audio device).
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname);
const mespeakJs = fs.readFileSync(path.join(ROOT, 'mespeak/mespeak.js'), 'utf8');
const coreJs = fs.readFileSync(path.join(ROOT, 'mespeak/mespeak-core.js'), 'utf8');

// --- minimal browser shims ---
function makeXhr(baseDir) {
  return function XHRMock() {
    this.open = (method, url) => { this._url = url; };
    this.send = () => {
      const p = urlToPath(this._url);
      try {
        this.status = 200;
        this.readyState = 4;
        this.responseText = fs.readFileSync(p, 'utf8');
        this.response = this.responseText;
      } catch (e) {
        this.status = 404;
        this.readyState = 4;
        this.responseText = '';
      }
      if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
      if (typeof this.onload === 'function') this.onload();
    };
  };
  function urlToPath(u) {
    const m = /^file:\/\/(\/.*)$/.exec(String(u));
    if (m) return decodeURIComponent(m[1]);
    if (/^voices\//.test(u)) return path.join(baseDir, u);
    return path.join(ROOT, String(u).replace(/^\.\//, ''));
  }
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Math, JSON, Date, Error, String, Number, Array, Object, RegExp, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  AudioContext: undefined,
  location: { protocol: 'file:', href: 'file:///nav.html', search: '' },
  // meSpeak reads these to compute baseUrl
  document: {
    currentScript: { src: 'file://' + path.join(ROOT, 'mespeak/mespeak.js').replace(/\\/g, '/') },
    getElementsByTagName: () => [{
      appendChild: (el) => { if (typeof el.onload === 'function') el.onload(); },
    }],
    createElement: (tag) => ({ tagName: tag, set src(v) {}, onload: null }),
  },
  XMLHttpRequest: makeXhr(path.join(ROOT, 'mespeak')),
};
sandbox.self = sandbox;
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.navigator = { userAgent: 'Mozilla/5.0 (X11; Linux) AppleWebKit/537.36 Chrome/76.0 Safari/537.36' }; // no Worker in sandbox -> instance mode
sandbox.Worker = undefined;
// emscripten calls a few globals at init
sandbox.Module = undefined;

const ctx = vm.createContext(sandbox);
try {
  // must be loaded in order: core first (defines meSpeakCore), then front-end
  vm.runInContext(coreJs, ctx, { filename: 'mespeak-core.js' });
  vm.runInContext(mespeakJs, ctx, { filename: 'mespeak.js' });
  const meSpeak = ctx.meSpeak;
  if (!meSpeak || typeof meSpeak.speak !== 'function') {
    console.log('FAIL: meSpeak global not defined'); process.exit(1);
  }
  console.log('meSpeak API OK, runMode =', meSpeak.getRunMode && meSpeak.getRunMode());
  meSpeak.loadVoice('es', (ok, msg) => {
    if (!ok) { console.log('FAIL: voice es not loaded:', msg); process.exit(1); }
    console.log('voice es loaded OK, default =', meSpeak.getDefaultVoice());
    meSpeak.speak('En quinientos metros, gire a la derecha.', { rawdata: true, amplitude: 140, pitch: 62, speed: 160 }, (success, id, stream) => {
      if (!success || !stream) { console.log('FAIL: synthesis failed'); process.exit(1); }
      const buf = Buffer.from(stream instanceof ArrayBuffer ? new Uint8Array(stream) : stream);
      console.log('WAV bytes:', buf.length);
      if (buf.length < 44) { console.log('FAIL: wav too small'); process.exit(1); }
      const riff = buf.toString('ascii', 0, 4);
      const wave = buf.toString('ascii', 8, 12);
      const sampleRate = buf.readUInt32LE(24);
      const dataLen = buf.readUInt32LE(40);
      console.log('RIFF=' + riff, 'WAVE=' + wave, 'rate=' + sampleRate, 'data=' + dataLen + ' bytes (' + (dataLen / sampleRate).toFixed(1) + 's)');
      // non-silent check: peak sample amplitude
      let peak = 0;
      for (let i = 44; i + 1 < buf.length && i < 44 + 20000; i += 2) {
        peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
      }
      console.log('peak sample:', peak, peak > 500 ? '→ voice audible' : '→ check');
      console.log(peak > 500 ? 'PASS' : 'WARN');
      process.exit(0);
    });
  });
} catch (e) {
  console.log('FAIL exception:', e && e.stack || e);
  process.exit(1);
}