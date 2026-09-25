// Runs every example in public/presets.js through the model (Node, CPU) and prints the answers.
// usage: node presets.mjs [modelDir]
import * as ort from "onnxruntime-node";
import { readFile } from "node:fs/promises";
import { createAgent } from "../public/engine.js";
import { PRESETS } from "../public/presets.js";

const dir = process.argv[2] ?? new URL("../public/models/laya-web/", import.meta.url).pathname;
const read = (f) => readFile(`${dir}/${f}`);
const agent = await createAgent(ort, {
  encoder: await read("encoder.onnx"), head: await read("head.onnx"),
  cfg: JSON.parse(await read("rl_agent_config.json")), tokenizer: JSON.parse(await read("tokenizer.json")),
}, { eps: ["cpu"] });

const pct = (p) => `${(100 * p).toFixed(0)}%`;
for (const [name, p] of Object.entries(PRESETS)) {
  const qs = Object.fromEntries(p.questions.map((q, i) => [`q${i}`, {
    type: q.type, instructions: q.instructions,
    ...(q.type === "choice" && { criteria: Object.fromEntries(q.options.map((o) => [o.label, o.desc ?? null])) }),
    ...(q.type === "score" && { criteria: q.options.map((o) => o.label) }),
  }]));
  const r = await agent.predict(p.text, qs);
  console.log(`\n## ${name}`);
  p.questions.forEach((q, i) => {
    const a = r.answers[`q${i}`];
    const probs = a.type === "noul" ? `yes ${pct(a.noul)}`
      : Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])
          .map(([k, v]) => `${a.type === "score" ? a.legend[k] : k} ${pct(v)}`).join(" | ");
    console.log(`- ${q.instructions}  →  ${probs}`);
  });
}
