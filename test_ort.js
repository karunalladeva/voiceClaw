try {
  console.log("Loading onnxruntime-node@1.21.0...");
  const ort = require("onnxruntime-node");
  console.log("Success!", Object.keys(ort));
} catch (e) {
  console.error("Failed:", e);
}