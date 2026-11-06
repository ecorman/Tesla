const puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const p = await b.newPage();
  p.on("console", m => console.log("CONSOLE[" + m.type() + "]", m.text()));
  await p.goto("file:///E:/Android/TeslaNav/sonido.html");
  const r = await p.evaluate(async () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = 'class P extends AudioWorkletProcessor{static get parameterDescriptors(){return []}process(i,o){return true}} registerProcessor("t-try2",P);';
    const out = {};
    // 1) data: URL
    try {
      await ctx.audioWorklet.addModule("data:application/javascript;base64," + btoa(src));
      out.data = "ok";
      try { new AudioWorkletNode(ctx, "t-try2", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] }); out.dataNode = "ok"; } catch (e) { out.dataNode = "FAIL " + e.message; }
    } catch (e) { out.data = "FAIL: " + ((e && e.message) || String(e)); }
    // 2) archivo relativo
    try {
      await ctx.audioWorklet.addModule("./sonido.worklet.js");
      out.file = "ok";
      try { new AudioWorkletNode(ctx, "t-try2b", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] }); out.fileNode = "ok"; } catch (e) { out.fileNode = "FAIL " + e.message; }
    } catch (e) { out.file = "FAIL: " + ((e && e.message) || String(e)); }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})().catch(e => console.log("ERR", e.message));
