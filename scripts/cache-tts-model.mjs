import { KokoroTTS } from 'kokoro-js';

const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
await KokoroTTS.from_pretrained(modelId, { dtype: 'q8', device: 'cpu' });
console.log(`Cached ${modelId}`);
