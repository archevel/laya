// Laya in the browser: ask typed questions about a text and show the calibrated answers.
// Model: convaiinnovations/laya as the split int8 ONNX export (encoder.onnx + head.onnx).
// The encoder runs on WebGPU when there is a usable adapter, otherwise on WASM (CPU).
// URL params: ?model=local (serve files from ./models/laya-web), ?backend=wasm (skip WebGPU).
import { createAgent } from "./engine.js";
import { PRESETS } from "./presets.js";

const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const REMOTE = "https://huggingface.co/archevel/laya-web/resolve/da1f5571da8fa8d3147e7123bd91992b794150b2";
const params = new URLSearchParams(location.search);
const BASE = params.get("model") === "local" ? new URL("models/laya-web", location.href).href : REMOTE;
const FILES = { encoder: ["encoder.onnx", 569], head: ["head.onnx", 35] };
const TYPE_NAMES = { choice: "Choice", noul: "Yes / no", score: "Scale" };

const $ = (id) => document.getElementById(id);
const els = {
  backend: $("backend"), status: $("status"), gate: $("gate"), gateText: $("gate-text"),
  gateNote: $("gate-note"), gateBtn: $("gate-btn"), progress: $("progress"), bar: $("bar"),
  state: $("state"), preset: $("preset"), questions: $("questions"), run: $("run"), share: $("share"),
  results: $("results"), log: $("log"), tpl: $("q-template"),
};

let agent = null;
let backend = "";
let setup = { text: "", questions: [] };

function log(msg) { console.log(msg); els.log.textContent += msg + "\n"; }
function status(msg) { els.status.textContent = msg; }

// ---------- setup state (editor + URL hash) ----------
function encodeSetup(s) {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeSetup(h) {
  const bin = atob(h.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}
function loadSetup(s) {
  setup = structuredClone(s);
  els.state.value = setup.text;
  renderEditor();
}
function saveHash() { history.replaceState(null, "", "#" + encodeSetup(setup)); }

function blankQuestion(type) {
  if (type === "choice") return { type, instructions: "", options: [{ label: "" }, { label: "" }] };
  if (type === "score") return { type, instructions: "", options: [{ label: "low" }, { label: "medium" }, { label: "high" }] };
  return { type, instructions: "" };
}

function renderEditor() {
  els.questions.replaceChildren(...setup.questions.map((q, qi) => {
    const node = els.tpl.content.firstElementChild.cloneNode(true);
    node.dataset.type = q.type;
    node.querySelector(".q-type").textContent = TYPE_NAMES[q.type];
    const ins = node.querySelector(".q-ins");
    ins.value = q.instructions;
    ins.placeholder = q.type === "noul" ? "A yes/no question, e.g. Does the user ask for a refund?"
      : q.type === "score" ? "What to rate, e.g. How urgent is this?" : "Which option fits, e.g. Which department?";
    ins.addEventListener("input", () => { q.instructions = ins.value; saveHash(); });
    node.querySelector(".remove").addEventListener("click", () => { setup.questions.splice(qi, 1); renderEditor(); saveHash(); });
    const list = node.querySelector(".opts");
    const addOpt = node.querySelector(".add-opt");
    if (q.type === "noul") { list.remove(); addOpt.remove(); return node; }
    addOpt.textContent = q.type === "score" ? "+ level" : "+ option";
    addOpt.addEventListener("click", () => { q.options.push({ label: "" }); renderEditor(); saveHash(); focusLast(qi); });
    q.options.forEach((o, oi) => {
      const li = document.createElement("li");
      const label = Object.assign(document.createElement("input"), {
        className: "opt-label", value: o.label,
        placeholder: q.type === "score" ? `level ${oi}, e.g. ${["low", "medium", "high"][oi] ?? "higher"}` : "label",
      });
      label.addEventListener("input", () => { o.label = label.value; saveHash(); });
      li.append(label);
      if (q.type === "choice") {
        const desc = Object.assign(document.createElement("input"), {
          className: "opt-desc", value: o.desc ?? "", placeholder: "description (optional)",
        });
        desc.addEventListener("input", () => { o.desc = desc.value; saveHash(); });
        li.append(desc);
      }
      const rm = Object.assign(document.createElement("button"), {
        className: "icon", textContent: "×", title: "Remove", ariaLabel: "Remove option",
      });
      rm.addEventListener("click", () => { q.options.splice(oi, 1); renderEditor(); saveHash(); });
      li.append(rm);
      list.append(li);
    });
    return node;
  }));
}
function focusLast(qi) {
  const inputs = els.questions.children[qi]?.querySelectorAll(".opt-label");
  inputs?.[inputs.length - 1]?.focus();
}

// Editor state -> laya questions. Throws a readable message for incomplete questions.
function toLaya() {
  const out = {};
  setup.questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.instructions.trim()) throw new Error(`Question ${n} has no text.`);
    const def = { type: q.type, instructions: q.instructions.trim() };
    if (q.type !== "noul") {
      const opts = q.options.filter((o) => o.label.trim());
      if (opts.length < 2) throw new Error(`Question ${n} needs at least two ${q.type === "score" ? "levels" : "options"}.`);
      if (q.type === "choice") {
        const labels = opts.map((o) => o.label.trim());
        if (new Set(labels).size !== labels.length) throw new Error(`Question ${n} has duplicate option labels.`);
        def.criteria = Object.fromEntries(opts.map((o) => [o.label.trim(), o.desc?.trim() || null]));
      } else {
        def.criteria = opts.map((o) => o.label.trim());
      }
    }
    out[`q${n}`] = def;
  });
  if (!Object.keys(out).length) throw new Error("Add a question first.");
  return out;
}

// ---------- results ----------
const pct = (p) => (p >= 0.995 ? ">99" : p < 0.005 ? "<1" : (100 * p).toFixed(0)) + "%";
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function bar(label, p, { win = false, desc = "" } = {}) {
  const row = el("div", "bar-row" + (win ? " win" : ""));
  const name = el("div", "bar-label");
  name.append(el("span", "", label));
  if (desc) name.append(el("span", "bar-desc", desc));
  const track = el("div", "track");
  const fill = el("div", "fill");
  fill.style.width = `${(100 * p).toFixed(1)}%`;
  track.append(fill);
  row.append(name, track, el("div", "bar-pct", pct(p)));
  return row;
}

function renderAnswer(q, a) {
  const card = el("article", "answer");
  card.append(el("div", "a-question", q.instructions));
  const head = el("div", "a-head");
  const body = el("div", "a-body");
  if (a.type === "choice") {
    const opts = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
    head.append(el("span", "a-value", a.choice), el("span", "a-prob", pct(a.probabilities[a.choice])));
    const descs = Object.fromEntries(q.options.map((o) => [o.label.trim(), o.desc?.trim() ?? ""]));
    for (const [label, p] of opts) body.append(bar(label, p, { win: label === a.choice, desc: descs[label] }));
    if (opts.length >= 11) body.append(el("p", "warn", "With 11 or more options this checkpoint's calibration is unreliable; treat the percentages as rough."));
  } else if (a.type === "score") {
    const probs = Object.entries(a.probabilities).map(([k, p]) => [Number(k), p]).sort((x, y) => x[0] - y[0]);
    const top = probs.reduce((b, c) => (c[1] > b[1] ? c : b));
    head.append(el("span", "a-value", String(a.legend[top[0]])), el("span", "a-prob", pct(top[1])));
    const max = probs.length - 1;
    const gauge = el("div", "gauge");
    gauge.title = `Expected level ${a.score.toFixed(2)} of ${max}`;
    const marker = el("div", "gauge-marker");
    marker.style.left = `${(100 * a.score) / max}%`;
    gauge.append(marker);
    body.append(gauge, el("div", "gauge-caption", `expected level ${a.score.toFixed(2)} on a 0–${max} scale`));
    for (const [lvl, p] of probs) body.append(bar(`${lvl} · ${a.legend[lvl]}`, p, { win: lvl === top[0] }));
  } else {
    const yes = a.noul;
    head.append(el("span", "a-value " + (yes >= 0.5 ? "yes" : "no"), yes >= 0.5 ? "Yes" : "No"),
      el("span", "a-prob", pct(Math.max(yes, 1 - yes))));
    const split = el("div", "split");
    const y = el("div", "split-yes", yes >= 0.08 ? `yes ${pct(yes)}` : "");
    const n = el("div", "split-no", 1 - yes >= 0.08 ? `no ${pct(1 - yes)}` : "");
    y.style.flexBasis = `${100 * yes}%`;
    n.style.flexBasis = `${100 * (1 - yes)}%`;
    split.append(y, n);
    body.append(split);
  }
  card.append(head, body);
  return card;
}

async function run() {
  if (!agent || els.run.disabled) return;
  let questions;
  try { questions = toLaya(); } catch (e) { return showError(e.message); }
  setup.text = els.state.value;
  if (!setup.text.trim()) return showError("Write or paste some text first.");
  els.run.disabled = true;
  els.run.textContent = "Thinking…";
  const t0 = performance.now();
  try {
    const r = await agent.predict(setup.text, questions);
    const ms = performance.now() - t0;
    const cards = setup.questions.map((q, i) => renderAnswer(q, r.answers[`q${i + 1}`]));
    const meta = el("p", "meta", `${ms.toFixed(0)} ms on ${backend} · ${r.usage.input_tokens} tokens`);
    els.results.replaceChildren(...cards, meta);
    log(`predict: ${ms.toFixed(0)} ms, ${r.usage.input_tokens} tokens`);
  } catch (e) {
    showError("Inference failed: " + (e.message || e));
    log("ERROR: " + (e.stack || e));
  } finally {
    els.run.disabled = false;
    els.run.textContent = "Ask";
  }
}
function showError(msg) { els.results.replaceChildren(el("p", "error", msg)); }

// ---------- model loading ----------
async function fetchWithCache(url, sizeMB, onProgress) {
  let cache = null;
  try { cache = await caches.open("laya-models"); } catch { /* unavailable (private mode, file://) */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const declared = Number(res.headers.get("content-length")) || 0;
  const total = declared || sizeMB * 1048576;
  const reader = res.body.getReader();
  let buf = declared ? new Uint8Array(declared) : null;
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (buf && received + value.byteLength > buf.byteLength) { chunks.push(buf.subarray(0, received)); buf = null; }
    if (buf) buf.set(value, received); else chunks.push(value);
    received += value.byteLength;
    onProgress(received, total);
  }
  if (!buf) {
    buf = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  } else if (received !== declared) {
    buf = buf.slice(0, received);
  }
  if (cache) {
    try { await cache.put(url, new Response(buf, { headers: { "content-length": String(received) } })); }
    catch (e) { log("cache.put failed (quota?): " + e.message); }
  }
  return buf;
}

async function isCached() {
  try { return !!(await (await caches.open("laya-models")).match(`${BASE}/${FILES.encoder[0]}`)); }
  catch { return false; }
}

async function download() {
  const files = {};
  let doneMB = 0;
  els.progress.hidden = false;
  for (const [key, [name, sizeMB]] of Object.entries(FILES)) {
    files[key] = await fetchWithCache(`${BASE}/${name}`, sizeMB, (r, t) => {
      const mb = doneMB + (r / t) * sizeMB;
      els.bar.style.width = `${Math.min(100, (100 * mb) / totalMB()).toFixed(1)}%`;
      status(`Downloading model… ${mb.toFixed(0)} / ${totalMB()} MB`);
    });
    doneMB += sizeMB;
  }
  els.progress.hidden = true;
  const json = async (name) => JSON.parse(new TextDecoder().decode(await fetchWithCache(`${BASE}/${name}`, 1, () => {})));
  files.cfg = await json("rl_agent_config.json");
  files.tokenizer = await json("tokenizer.json");
  return files;
}

async function webgpuAdapter() {
  if (params.get("backend") === "wasm") return { reason: "WASM forced by ?backend=wasm" };
  if (!("gpu" in navigator)) return { reason: "this browser has no WebGPU" };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    // Chrome on Linux ships WebGPU switched off; the user has to opt in.
    const linuxChrome = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent) && /Chrome\//.test(navigator.userAgent);
    return { reason: linuxChrome
      ? "no WebGPU adapter. On Linux, enable chrome://flags/#enable-unsafe-webgpu and chrome://flags/#enable-vulkan, then relaunch Chrome"
      : "no WebGPU adapter" };
  }
  const info = adapter.info || {};
  const desc = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(" / ") || "unknown GPU";
  log(`WebGPU adapter: ${desc}; shader-f16: ${adapter.features.has("shader-f16")}`);
  if (info.architecture === "swiftshader") return { reason: "WebGPU is SwiftShader (CPU emulation)" };
  return { desc };
}

const isMobile = navigator.userAgentData?.mobile
  || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);   // iPadOS reports as a Mac

// Fewer copies of the ~600 MB weights: phones kill tabs that hold several of them at once.
const LEAN = {
  enableMemPattern: false,
  enableCpuMemArena: false,
  extra: { session: { disable_prepacking: "1", use_device_allocator_for_initializers: "1" } },
};

async function loadModel(gpu) {
  els.gate.hidden = true;
  const ort = window.ort;
  if (!ort) return status("onnxruntime-web failed to load from the CDN.");
  ort.env.wasm.wasmPaths = ORT_CDN;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  // WASM inference runs in a worker so the page stays responsive during multi-second runs.
  // Proxy mode is WASM-only and must be set before the first session, so only when there is no GPU.
  if (!gpu.desc) ort.env.wasm.proxy = true;
  let files;
  try {
    files = await download();
  } catch (e) {
    els.progress.hidden = true;
    els.gate.hidden = false;
    log("ERROR: " + (e.stack || e));
    return status("Download failed: " + (e.message || e));
  }
  const t0 = performance.now();
  if (gpu.desc) {
    status("Preparing the model for your GPU…");
    try {
      agent = await warmUp(await createAgent(ort, files, { eps: ["webgpu"], headEps: ["wasm"], options: LEAN }));
      backend = "WebGPU";
      els.backend.title = gpu.desc;
    } catch (e) {
      agent = null;
      log("WebGPU failed: " + (e.stack || e));
      gpu.reason = "WebGPU failed (see log)";
      // A phone would run out of memory or take tens of seconds per question on WASM.
      if (isMobile) return status("The model could not run on this phone's GPU. Try a desktop browser.");
    }
  }
  if (!agent) {
    status("Preparing the model for the CPU…");
    try {
      agent = await warmUp(await createAgent(ort, files, { eps: ["wasm"], options: LEAN }));
      backend = "CPU (WASM)";
      els.backend.title = gpu.reason;
    } catch (e) {
      log("ERROR: " + (e.stack || e));
      return status("Could not load the model: " + (e.message || e));
    }
  }
  files = null;   // the sessions own the weights now; let the JS copy be collected
  log(`model ready on ${backend} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  els.backend.textContent = backend;
  els.backend.classList.add(backend === "WebGPU" ? "gpu" : "cpu");
  status(backend === "WebGPU" ? "" : `Slower: ${gpu.reason}.`);
  els.run.disabled = false;
}

// Ask before the first download: say how big it is, and whether this device is a good idea.
function showGate(gpu) {
  const conn = navigator.connection;
  const notes = [];
  if (isMobile && !gpu.desc) {
    els.gateText.textContent = "This page needs WebGPU to run on a phone, and this browser doesn't provide it. " +
      "It works in Safari on iOS 26 or later and in Chrome on recent Android phones. Otherwise, use a desktop browser.";
    els.gateBtn.hidden = true;
    els.gate.hidden = false;
    return;
  }
  els.gateText.textContent = `The model is ${totalMB()} MB. It downloads once, then your browser keeps it, ` +
    "and everything runs on this device.";
  if (conn?.saveData || conn?.type === "cellular") notes.push("You seem to be on mobile data or data saver.");
  if (isMobile) notes.push("Phones are experimental: the model needs about 1 GB of memory, and the browser may close the tab on phones with less.");
  if (!gpu.desc) notes.push(`No usable GPU (${gpu.reason}), so it will run on the CPU, several seconds per question.`);
  els.gateNote.textContent = notes.join(" ");
  els.gateBtn.textContent = `Download model (${totalMB()} MB)`;
  els.gateBtn.onclick = () => loadModel(gpu);
  els.gate.hidden = false;
}
const totalMB = () => FILES.encoder[1] + FILES.head[1];

// The first run compiles GPU shaders; do it here so the first real question is fast,
// and so a backend that loads but cannot execute is caught before we commit to it.
async function warmUp(a) {
  await a.predict("warm up", { q: { type: "noul", instructions: "Is this a test?" } });
  return a;
}

// ---------- wiring ----------
for (const name of Object.keys(PRESETS)) els.preset.append(new Option(name, name));
els.preset.addEventListener("change", () => {
  if (els.preset.value) loadSetup(PRESETS[els.preset.value]);
  els.preset.value = "";
  els.results.replaceChildren();
  saveHash();
});
els.state.addEventListener("input", () => { setup.text = els.state.value; saveHash(); });
document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
  setup.questions.push(blankQuestion(b.dataset.add));
  renderEditor();
  saveHash();
  els.questions.lastElementChild.querySelector(".q-ins").focus();
}));
els.run.addEventListener("click", run);
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
els.share.addEventListener("click", async () => {
  saveHash();
  try { await navigator.clipboard.writeText(location.href); els.share.textContent = "Copied"; }
  catch { els.share.textContent = "Copy the address bar"; }
  setTimeout(() => (els.share.textContent = "Copy link to this setup"), 1500);
});

try { loadSetup(location.hash.length > 1 ? decodeSetup(location.hash.slice(1)) : Object.values(PRESETS)[0]); }
catch { loadSetup(Object.values(PRESETS)[0]); }

const gpu = await webgpuAdapter();
if (await isCached() || params.get("model") === "local") loadModel(gpu);
else showGate(gpu);
