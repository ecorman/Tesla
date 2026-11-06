const puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const p = await b.newPage();
  p.on("pageerror", e => console.log("PAGEERROR:", e.message));
  await p.goto("file:///E:/Android/TeslaNav/sonido.html?probe");
  await p.click("#start");
  await p.click("#demoTog");
  // subir a 120 km/h y esperar estabilización
  await p.evaluate(() => {
    const el = document.getElementById("demo");
    el.value = 120;
    el.dispatchEvent(new Event("input"));
  });
  await new Promise(r => setTimeout(r, 5000));
  const spec = await p.evaluate(() => {
    const an = window.__an;
    const buf = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(buf);
    const binHz = an.context.sampleRate / an.fftSize;
    const out = [];
    for (let i = 1; i <= 40; i++) out.push({ hz: (i * binHz).toFixed(0), db: buf[i].toFixed(1) });
    return { binHz: binHz.toFixed(2), spec: out, rpm: Math.round(S.rpm) };
  });
  console.log("rpm:", spec.rpm);
  for (const row of spec.spec) console.log(row.hz, row.db);
  await b.close();
})().catch(e => console.log("ERR", e.message));
