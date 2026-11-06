const puppeteer = require("puppeteer-core");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));

  await page.goto("file:///E:/Android/TeslaNav/sonido.html?probe");
  await new Promise(r => setTimeout(r, 500));

  // arrancar sonido
  await page.click("#start");
  // activar modo demo
  await page.click("#demoTog");
  // establecer velocidad simulada
  await page.evaluate(() => {
    const el = document.getElementById("demo");
    el.value = 0;
    el.dispatchEvent(new Event("input"));
  });
  await new Promise(r => setTimeout(r, 800));

  const speed0 = await page.evaluate(() => document.getElementById("speed").textContent);

  // acelerar el "acelerador" del demo
  await page.evaluate(() => {
    const el = document.getElementById("demo");
    el.value = 120;
    el.dispatchEvent(new Event("input"));
  });
  await new Promise(r => setTimeout(r, 6000)); // frame loop slows target

  const st = await page.evaluate(() => ({
    speed: document.getElementById("speed").textContent,
    gear: document.getElementById("gear").textContent,
    rpm: (typeof S !== "undefined") ? Math.round(S.rpm) : null,
    running: (typeof S !== "undefined") ? S.running : null,
    demo: (typeof S !== "undefined") ? S.demo : null,
    modo: (typeof S !== "undefined") ? (S.wl ? "AudioWorklet (DSP)" : "osciladores (reserva)") : null,
  }));
  // nivel de audio real (RMS) desde el analizador
  const rms = await page.evaluate(() => new Promise(res => {
    const an = window.__an;
    if (!an) { res(null); return; }
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    res(Math.sqrt(s / buf.length));
  }));
  console.log("RMS audio:", rms);

  // espectral: el pico de graves debe seguir la orden de encendido del V8 (4×f0)
  const spec = await page.evaluate(() => new Promise(res => {
    const an = window.__an;
    if (!an) { res(null); return; }
    const buf = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(buf);
    const binHz = an.context.sampleRate / an.fftSize;
    let best = -Infinity, bestI = -1;
    for (let i = 2; i < Math.floor(400 / binHz); i++) {
      if (buf[i] > best) { best = buf[i]; bestI = i; }
    }
    res({ peakHz: bestI * binHz, rpmNow: Math.round(S.rpm) });
  }));
  if (spec) {
    const orderIdExpected = 4 * spec.rpmNow / 60;
    console.log("pico espectral:", spec.peakHz.toFixed(1), "Hz; esperado (orden 4 x f0):", orderIdExpected.toFixed(1), "Hz");
  }
  console.log("speed al inicio:", speed0);
  console.log("tras demo 120 km/h:", JSON.stringify(st));
  if (typeof S !== "undefined" && S.wlErr) console.log("fallo Worklet:", S.wlErr);

  // Rev mantenido parado
  const revTest = await page.evaluate(async () => {
    S.demoSpeed = 0; await new Promise(r => setTimeout(r, 2500));
    const rev = document.getElementById("rev");
    rev.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise(r => setTimeout(r, 3200));
    const out = { rpm: Math.round(S.rpm), revHold: S.revHold };
    rev.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await new Promise(r => setTimeout(r, 2500));
    out.rpmTrasSoltar = Math.round(S.rpm);
    return out;
  });
  console.log("Rev mantenido:", JSON.stringify(revTest));

  await page.evaluate(() => { S.demoSpeed = 30; S.speed = 30; });   // cruza en 3.ª
  await new Promise(r => setTimeout(r, 3000));
  const shiftSeries = [];
  for (let v = 0; v <= 7; v++) {
    const sp = 20 + v * 25;                                        // 20 → 195 km/h
    shiftSeries.push(await page.evaluate(x => {
      S.demoSpeed = x;
      return new Promise(res => setTimeout(() => res({
        kmh: x, gear: document.getElementById("gear").textContent, rpm: Math.round(S.rpm)
      }), 2200));
    }, sp));
  }
  console.log("secuencia marchas:", JSON.stringify(shiftSeries));

  // dejar que baje a 0 y comprobar marcha N
  await page.evaluate(() => {
    const el = document.getElementById("demo");
    el.value = 0;
    el.dispatchEvent(new Event("input"));
  });
  await new Promise(r => setTimeout(r, 9000));
  const st2 = await page.evaluate(() => ({
    speed: document.getElementById("speed").textContent,
    gear: document.getElementById("gear").textContent,
  }));
  console.log("al frenar a 0:", JSON.stringify(st2));

  await page.screenshot({ path: "sonido-test.png" });
  console.log("errores consola:", errors.length ? errors : "ninguno");

  await browser.close();
})().catch(e => { console.error("FALLO TEST:", e.message); process.exit(1); });
