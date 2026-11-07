/* Prueba contra la web publicada en GitHub Pages (origen HTTPS real). */
const puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
  p.on("console", m => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
  await p.goto("https://ecorman.github.io/Tesla/sonido.html?probe", { waitUntil: "load", timeout: 60000 });
  await p.click("#start");
  await p.click("#demoTog");
  await p.evaluate(() => {
    const el = document.getElementById("demo");
    el.value = 120;
    el.dispatchEvent(new Event("input"));
  });
  await new Promise(r => setTimeout(r, 6000));
  const st = await p.evaluate(() => new Promise(res => {
    const an = window.__an;
    if (!an) { res({ rms: null, modo: S.wl ? "worklet-sin-an" : "reserva" }); return; }
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let s = 0; for (const v of buf) s += v * v;
    res({
      rms: Math.round(Math.sqrt(s / buf.length) * 1000) / 1000,
      modo: S.wl ? (S.wlS && S.wlS.wlErr ? "DSP con error: " + S.wlS.wlErr : "AudioWorklet (DSP)") : "osciladores (reserva)",
      speed: S.speed, gear: S.gear, rpm: Math.round(S.rpm),
      freqData: (() => { const f = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(f); const hz = an.context.sampleRate / an.fftSize; let bi = -1, bv = -Infinity; for (let i = 2; i < Math.floor(400 / hz); i++) if (f[i] > bv) { bv = f[i]; bi = i; } return bi * hz; })(),
    });
  }));
  console.log("estado en GitHub Pages:", JSON.stringify(st));
  console.log("errores consola:", errs.length ? errs.join(" | ") : "ninguno");
  await b.close();
})().catch(e => console.log("ERR", e.message));
