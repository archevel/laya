"""Widen fp16 initializers in an ONNX model to fp32 (lossless).

cut-laya-onnx stores the token-embedding table in fp16, and onnxruntime-web's WebGPU Gather
then needs the "shader-f16" feature, which Chrome does not expose on e.g. Linux/NVIDIA.
In cut-laya the only consumer of that Gather is a Cast to fp32, which becomes a no-op.

usage: python embeddings_to_fp32.py in.onnx out.onnx
"""
import sys
import numpy as np
import onnx
from onnx import TensorProto, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
widened = []
for i, t in enumerate(g.initializer):
    if t.data_type == TensorProto.FLOAT16:
        arr = numpy_helper.to_array(t).astype(np.float32)
        g.initializer[i].CopyFrom(numpy_helper.from_array(arr, t.name))
        widened.append(t.name)
print("widened:", widened)

# The Gather output is now fp32 too: print its consumers so a non-Cast consumer gets noticed.
outs = {n.output[0] for n in g.node if n.op_type == "Gather" and n.input[0] in widened}
for n in g.node:
    if any(i in outs for i in n.input):
        print("consumer:", n.op_type, n.name, [(a.name, a.i) for a in n.attribute])
for vi in list(g.value_info):
    if vi.name in outs:
        vi.type.tensor_type.elem_type = TensorProto.FLOAT
onnx.checker.check_model(m, full_check=False)
onnx.save(m, dst)
