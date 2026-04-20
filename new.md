📂 EVOLUTION_PIPELINE.md
🏗️ 1. Phase 1: Context Harvesting & Dataset Synthesis
The Node.js backend scans your workspace/ and history/ and uses a local LLM to "clean" the data into training pairs.

Sample Logic (Node.js):

TypeScript
// src/services/DatasetGenerator.ts
import { spawn } from 'child_process';

async function generateTrainingPair(rawCode: string) {
  // Call Ollama to summarize the code into an Instruction/Output pair
  const prompt = `Convert this code into a JSON training pair: 
                  { "instruction": "How do I implement X?", "output": "${rawCode}" }`;
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model: 'llama3.1', prompt, stream: false })
  });
  return response.json();
}
🛡️ 2. Phase 2: Security & Verification
Before training, the system presents a "Review Queue" in your UI.

PII Sanitizer: A background script replaces strings like 123 Dubai Marina with [REDACTED_ADDRESS].

Human-in-the-loop: You must click "Approve" on at least 100 samples before the "Train" button unlocks.

🚀 3. Phase 3: Unsloth Training Script
This Python script runs as a child_process and uses 4-bit QLoRA to fit within your 8GB VRAM.

Sample Script (scripts/train_model.py):

Python
from unsloth import FastLanguageModel
import torch
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# 1. Load Model (Optimized for 8GB VRAM)
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/llama-3.1-8b-bnb-4bit",
    max_seq_length = 2048,
    load_in_4bit = True,
)

# 2. Add LoRA Adapters
model = FastLanguageModel.get_peft_model(
    model,
    r = 16, 
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_alpha = 16,
)

# 3. Load your 'Verified' samples
dataset = load_dataset("json", data_files="workspace/verified_samples.jsonl", split="train")

# 4. Train
trainer = SFTTrainer(
    model = model,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = 2048,
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        warmup_steps = 5,
        max_steps = 60, # Small steps for quick updates
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 1,
        output_dir = "outputs",
    ),
)
trainer.train()

# 5. Export to Ollama GGUF
model.save_pretrained_gguf("model_v1", tokenizer, quantization_method = "q4_k_m")
📅 4. Phase 4: Automated Scheduling
Use a Node.js cron job to trigger training when the system is idle.

Sample Schedule (src/cron/trainer.ts):

TypeScript
import cron from 'node-cron';
import { spawn } from 'child_process';

// Every Sunday at 3 AM
cron.schedule('0 3 * * 0', () => {
  console.log("🚀 Starting Weekly model Evolution...");
  
  const pythonProcess = spawn('python', ['scripts/train_model.py']);
  
  pythonProcess.stdout.on('data', (data) => console.log(`Train: ${data}`));
  pythonProcess.on('close', (code) => {
    if (code === 0) {
      console.log("✅ Training Complete. Hot-swapping Ollama model...");
      spawn('ollama', ['create', 'model', '-f', 'Modelfile']);
    }
  });
});
📊 Training Data Sample (verified_samples.jsonl)
JSON
{"text": "### Instruction: Create a Flutter button with Dubai-themed colors. ### Response: Container(color: Color(0xFFD4AF37), child: Text('Gold Button'))"}
{"text": "### Instruction: How do I purge the VoiceClaw cache? ### Response: Run the 'npm run purge' command to clear the VRAM and temp files."}
💡 Why this works for you:
VRAM Safe: Unsloth uses 70% less memory, so your RTX 4070 won't crash during training.

Accuracy: The "Verification" step ensures your model doesn't learn "hallucinations" from your messy git history.

No Lag: The "Nightly Cron" ensures your i9 is 100% available for you during the day.

Gemini said
Building an automated fine-tuning pipeline for VoiceClaw is the ultimate way to transition from a "generic AI" to a personalized "Digital Twin."

Here is your detailed implementation pipeline.

🛠️ Phase 1: Context Harvesting (Workspace to Dataset)
The goal is to convert your raw coding files (.ts, .dart) and history.json into a training-ready dataset.

Extraction: Use a Node.js child_process to scan your workspace.

LLM "Data Cleaning": Pipe raw code snippets to your local Ollama (Llama 3.1) with a "Dataset Synthesis" prompt.

Prompt: "Transform this raw TypeScript function into a high-quality Instruction/Output pair where the instruction describes the intent and the output provides the optimized code in Karunalladeva's style."

Verification UI: In your Flutter client, present a "Review Card" for these generated pairs. You can "Approve," "Edit," or "Reject." Only "Approved" pairs move to the training bucket.

🔒 Phase 2: Security & Sanity Check
Before training starts, the pipeline must pass a security gateway:

PII Masking: Use a regex-based "Sanitizer" node to strip API keys, emails, or Dubai-specific personal addresses from the dataset.

Integrity Check: Ensure no "broken" code or empty responses exist. Training on broken code will make your model "hallucinate" syntax errors.

VRAM Guard: A Node script checks nvidia-smi. If current VRAM usage is > 2GB (e.g., you are gaming), it postpones the schedule to avoid an OOM (Out of Memory) crash.

🚀 Phase 3: The Unsloth Training Execution
Since Unsloth is Python-based, you will trigger it from Node.js using spawn.

The Training Script (train.py)
Unsloth allows you to use 4-bit QLoRA, which is the "magic" that makes this possible on an 8GB card.

Python
from unsloth import FastLanguageModel
import torch

# Load model in 4-bit for 8GB VRAM safety
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/llama-3.1-8b-bnb-4bit",
    max_seq_length = 2048,
    load_in_4bit = True,
)

# Add LoRA adapters (The 'Brain' Upgrade)
model = FastLanguageModel.get_peft_model(
    model,
    r = 16, # Rank: 16 is stable for 8GB VRAM
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_alpha = 16,
    lora_dropout = 0,
)

# [Logic to load your 'Verified' JSON dataset here]
# [Trainer.train() execution]

# Export directly for Ollama
model.save_pretrained_gguf("voiceclaw-model-v1", tokenizer, quantization_method = "q4_k_m")
📅 Phase 4: Scheduling & Deployment
The "Nightly" Cron: Use node-cron in a background child process.

Logic: If Time == 03:00 AM AND Dataset_Size > 100 New Pairs -> Start Fine-tune.

Ollama Hot-Swap: Once the GGUF is exported, the Node backend runs ollama create model-v1 -f Modelfile.

Version Control: Always keep the "Base" model. If the new "model-v1" starts acting weird (Model Drift), one click in your Flutter UI rolls back to the original Llama 3.1.
