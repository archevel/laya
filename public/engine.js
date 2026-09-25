// Builds a laya-ts Agent from already-downloaded model bytes and an onnxruntime module.
// Shared by the page (onnxruntime-web) and tools/smoke.mjs (onnxruntime-node), so both run
// the same code path. laya-ts does sequence building, tokenizing and calibration; this file
// only owns the ONNX sessions, so the page can report download progress and the backend used.
import { Agent, feed, feedHead, parseTokenizerJson, encodeWithData } from "./vendor/laya-ts/index.js";

function tokenizerFromHF(json) {
  const data = parseTokenizerJson(json);
  if (!data) throw new Error("unsupported tokenizer.json format");
  return {
    clsId: data.ids.cls, sepId: data.ids.sep, maskId: data.ids.mask, padId: data.ids.pad,
    maskToken: data.maskToken,
    encode: (text) => encodeWithData(data, text),
  };
}

function nested(t) {
  // laya-ts passes the encoder output back into feedHead as nested arrays.
  const [n, s, h] = t.dims;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = new Array(s);
    for (let j = 0; j < s; j++) {
      const o = (i * s + j) * h;
      out[i][j] = t.data.subarray(o, o + h);
    }
  }
  return out;
}

function toNumbers(t) {
  const [n, k] = t.dims;
  const out = [];
  for (let i = 0; i < n; i++) out.push(Array.from(t.data.subarray(i * k, (i + 1) * k)));
  return out;
}

/**
 * files: { encoder: Uint8Array, head: Uint8Array, cfg: object, tokenizer: object }
 * eps: execution providers for the encoder, e.g. ["webgpu"] or ["cpu"]; the head is small
 * and runs on headEps (default: last entry of eps). options: extra ORT session options.
 */
export async function createAgent(ort, files, { eps, headEps, options = {} } = {}) {
  const enc = await ort.InferenceSession.create(files.encoder, { ...options, executionProviders: eps });
  const head = await ort.InferenceSession.create(files.head, {
    ...options, executionProviders: headEps ?? [eps[eps.length - 1]],
  });
  const provider = {
    async runEncoder(b) {
      const out = await enc.run(feed(ort, b));
      return { lastHidden: nested(out.last_hidden_state) };
    },
    async runHead(hidden, b) {
      const out = await head.run(feedHead(ort, hidden, b));
      return { logits: toNumbers(out.logits), act: toNumbers(out.act_logits) };
    },
  };
  return new Agent({ provider, tok: tokenizerFromHF(files.tokenizer), cfg: files.cfg });
}
