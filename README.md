# Laya in the browser

Ask typed questions about a text and get calibrated answers from
[Laya](https://huggingface.co/convaiinnovations/laya) (ModernBERT-large, 421M, English checkpoint),
running entirely in the browser with onnxruntime-web on WebGPU. No backend: static files plus model weights.

Three question types: **choice** (pick one of labelled options, optional descriptions),
**yes / no**, and **scale** (ordered levels). Results show the probability of every option.
The setup (text + questions) lives in the URL hash, so a link reproduces it.

## Run

    node serve.mjs        # http://localhost:8080, weights from Hugging Face
                          # http://localhost:8080/?model=local uses public/models/laya-web/

URL params: `?model=local`, `?backend=wasm` (skip WebGPU).

## Model

Weights: https://huggingface.co/archevel/laya-web (604 MB: `encoder.onnx` 569 MB + `head.onnx` 35 MB).
That is [harshpreet931/cut-laya-onnx](https://huggingface.co/harshpreet931/cut-laya-onnx) (8-bit weight-only
matmuls, split encoder/head) with the fp16 token-embedding table widened to fp32. With fp16, WebGPU needs
`shader-f16`, which Chrome on Linux/NVIDIA does not expose (same issue as in kattbilder). Regenerate:

    mkdir -p public/models/cut-laya && cd public/models/cut-laya
    for f in encoder.onnx head.onnx rl_agent_config.json tokenizer.json; do
      curl -LO https://huggingface.co/harshpreet931/cut-laya-onnx/resolve/192138dfb32a0b2f73425ba70345946d415bfde1/$f; done
    cd .. && mkdir -p laya-web && cp cut-laya/{head.onnx,rl_agent_config.json,tokenizer.json} laya-web/
    nix-shell -p python3Packages.onnx python3Packages.numpy \
      --run "python3 ../../tools/embeddings_to_fp32.py cut-laya/encoder.onnx laya-web/encoder.onnx"
    nix-shell -p python3Packages.huggingface-hub --run "hf upload archevel/laya-web laya-web . --repo-type model"

Then update the pinned revision in `REMOTE` in `public/app.js`.

Int4 exports exist (~300 MB, e.g. VishalMysore/layaForWeb, techtheist/laya-onnx) but have been reported to
change the top answer on 11 of 57 test lines, so accuracy was preferred over size.

## Runtime

`public/vendor/laya-ts/` is [laya-ts](https://github.com/NandhaKishorM/laya/tree/main/laya-ts) (Apache-2.0)
compiled to JS from commit `4066d5d5`; it is not on npm. It builds the input sequence, tokenizes and applies
the calibration temperatures. `public/engine.js` owns the ONNX sessions (so the page can show download
progress and pick the backend) and is shared with the Node smoke test.

Known model caveat: the checkpoint's temperature for choice questions with 11+ options is 0.10; laya-ts clamps
it to 0.5, so those probabilities are uncalibrated (the page says so).

## Measured

| device | backend | 4 questions, 230 tokens |
|---|---|---|
| RTX 4070 laptop (Chrome/Linux, Vulkan flags) | WebGPU | ~0.8–1.2 s |
| Intel Arc iGPU, Meteor Lake | WebGPU | ~1.1 s |
| same laptop, no WebGPU | WASM, 1 thread | ~7–13 s |

Chrome on Linux needs the flags from the kattbilder README to expose WebGPU.

## Phones

Untested on real devices. Needs WebGPU: Safari on iOS 26+, Chrome on recent Android. Phones without WebGPU get a
note instead of a download (WASM would be too slow and memory-hungry). The weights need roughly 1 GB of memory
while loading; the page drops its JS copy after the session is built, but iOS may still kill the tab on
phones with less memory.

## Tests

    cd tools && npm install
    node smoke.mjs                                   # Node, CPU, local weights
    node presets.mjs                                 # every example in public/presets.js, answers printed
    node browser-test.mjs http://localhost:8080/     # headless Chrome with WebGPU flags
    VK_ICD_FILENAMES=/run/opengl-driver/share/vulkan/icd.d/intel_icd.x86_64.json node browser-test.mjs ...

## Deploy

Pushing to `main` deploys `public/` to GitHub Pages via `.github/workflows/pages.yml`.
