// Node smoke test: runs the page's engine.js on onnxruntime-node (CPU) against local model files.
// usage: node smoke.mjs [modelDir]
import * as ort from "onnxruntime-node";
import { readFile } from "node:fs/promises";
import { createAgent } from "../public/engine.js";

const dir = process.argv[2] ?? new URL("../public/models/laya-web/", import.meta.url).pathname;
const read = (f) => readFile(`${dir}/${f}`);
const agent = await createAgent(ort, {
  encoder: await read("encoder.onnx"),
  head: await read("head.onnx"),
  cfg: JSON.parse(await read("rl_agent_config.json")),
  tokenizer: JSON.parse(await read("tokenizer.json")),
}, { eps: ["cpu"] });

const state = "Hi, we were billed twice for March. Please refund the duplicate today or we will cancel our plan.";
const questions = {
  department: { type: "choice", instructions: "Which department should handle this?",
    criteria: { billing: "invoices, payments, refunds", technical: "bugs, outages, system errors", other: "everything else" } },
  urgency: { type: "score", instructions: "How urgent is this?", criteria: ["not urgent", "soon", "blocking"] },
  churn_risk: { type: "noul", instructions: "Does the user threaten to cancel or leave?" },
};
for (let i = 0; i < 2; i++) {
  const t = performance.now();
  const r = await agent.predict(state, questions);
  if (i) console.log(JSON.stringify(r, null, 1));
  console.log(`${(performance.now() - t).toFixed(0)} ms`);
}
