"""
VoiceClaw Self-Evolution — Unsloth QLoRA Fine-Tuning Script.

This script is spawned by the Node.js backend via child_process.
It fine-tunes a base model using 4-bit QLoRA on verified training samples,
then exports the result as a GGUF for Ollama hot-swap.

Usage:
  python scripts/train_model.py \
    --data-path workspace/evolution/verified_samples.jsonl \
    --output-dir workspace/evolution/models/voiceclaw-v1234 \
    --max-steps 60 \
    --lora-rank 16 \
    --learning-rate 2e-4 \
    --quant-method q4_k_m \
    --base-model unsloth/llama-3.1-8b-bnb-4bit
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="VoiceClaw Evolution — QLoRA Fine-Tuning Script"
    )
    parser.add_argument("--data-path", required=True, help="Path to verified_samples.jsonl")
    parser.add_argument("--output-dir", required=True, help="Output directory for GGUF model")
    parser.add_argument("--max-steps", type=int, default=60, help="Max training steps")
    parser.add_argument("--lora-rank", type=int, default=16, help="LoRA rank (r)")
    parser.add_argument("--learning-rate", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--quant-method", default="q4_k_m", help="GGUF quantization method")
    parser.add_argument("--base-model", default="unsloth/llama-3.1-8b-bnb-4bit", help="Base model to fine-tune")
    parser.add_argument("--max-seq-length", type=int, default=2048, help="Max sequence length")
    parser.add_argument("--batch-size", type=int, default=2, help="Per-device train batch size")
    parser.add_argument("--grad-accum", type=int, default=4, help="Gradient accumulation steps")
    parser.add_argument("--warmup-steps", type=int, default=5, help="Warmup steps")
    return parser.parse_args()


def load_samples(data_path: str) -> list[dict]:
    """Load JSONL training samples and format into Alpaca instruction template."""
    samples = []
    with open(data_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                # Format into instruction-output template
                text = f"### Instruction: {item['instruction']}\n### Response: {item['output']}"
                samples.append({"text": text})
            except (json.JSONDecodeError, KeyError) as e:
                print(f"[WARN] Skipping malformed sample: {e}", file=sys.stderr)
                continue
    return samples


def main():
    args = parse_args()

    print(f"[Evolution] Starting fine-tuning pipeline...")
    print(f"[Evolution] Base model:   {args.base_model}")
    print(f"[Evolution] Data path:    {args.data_path}")
    print(f"[Evolution] Output dir:   {args.output_dir}")
    print(f"[Evolution] Max steps:    {args.max_steps}")
    print(f"[Evolution] LoRA rank:    {args.lora_rank}")
    print(f"[Evolution] Learning rate: {args.learning_rate}")
    print(f"[Evolution] Quant method: {args.quant_method}")

    # 0. Load and validate training samples
    print("[Evolution] Loading training samples...")
    samples = load_samples(args.data_path)
    if len(samples) == 0:
        print("[ERROR] No valid training samples found!", file=sys.stderr)
        sys.exit(1)
    print(f"[Evolution] Loaded {len(samples)} training samples.")

    # 1. Import Unsloth (deferred to provide clear error messages)
    try:
        from unsloth import FastLanguageModel
        import torch
        from datasets import Dataset
        from trl import SFTTrainer
        from transformers import TrainingArguments
    except ImportError as e:
        print(f"[ERROR] Missing dependency: {e}", file=sys.stderr)
        print("[ERROR] Run: pip install -r scripts/requirements-evolution.txt", file=sys.stderr)
        sys.exit(1)

    start_time = time.time()

    # 2. Load base model with 4-bit quantization (VRAM-safe)
    print(f"[Evolution] Loading model: {args.base_model} (4-bit)...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
    )
    print("[Evolution] Model loaded successfully.")

    # 3. Apply LoRA adapters
    print(f"[Evolution] Adding LoRA adapters (rank={args.lora_rank})...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_rank,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_alpha=args.lora_rank,  # alpha = rank is the standard setting
        lora_dropout=0,
    )
    print("[Evolution] LoRA adapters applied.")

    # 4. Create HuggingFace Dataset from samples
    dataset = Dataset.from_list(samples)
    print(f"[Evolution] Dataset created: {len(dataset)} samples.")

    # 5. Configure training
    os.makedirs(args.output_dir, exist_ok=True)

    use_bf16 = torch.cuda.is_bf16_supported() if torch.cuda.is_available() else False
    use_fp16 = not use_bf16

    training_args = TrainingArguments(
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        warmup_steps=args.warmup_steps,
        max_steps=args.max_steps,
        learning_rate=args.learning_rate,
        fp16=use_fp16,
        bf16=use_bf16,
        logging_steps=1,
        output_dir=os.path.join(args.output_dir, "checkpoints"),
        seed=42,
        report_to="none",  # No wandb/mlflow — we report via stdout JSON
    )

    # 6. Train
    print("[Evolution] Starting training...")
    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        args=training_args,
    )

    train_result = trainer.train()
    print("[Evolution] Training complete!")

    # 7. Extract metrics
    final_loss = train_result.training_loss if hasattr(train_result, "training_loss") else None
    train_steps = train_result.global_step if hasattr(train_result, "global_step") else args.max_steps

    # 8. Export to GGUF for Ollama
    print(f"[Evolution] Exporting GGUF ({args.quant_method})...")
    gguf_output_dir = os.path.join(args.output_dir, "gguf")
    model.save_pretrained_gguf(gguf_output_dir, tokenizer, quantization_method=args.quant_method)

    # Find the generated GGUF file and copy to output root for easy access
    gguf_files = list(Path(gguf_output_dir).glob("*.gguf"))
    if gguf_files:
        import shutil
        final_gguf = os.path.join(args.output_dir, gguf_files[0].name)
        shutil.copy2(str(gguf_files[0]), final_gguf)
        print(f"[Evolution] GGUF exported to: {final_gguf}")
    else:
        print("[WARN] No GGUF file found after export.", file=sys.stderr)

    # 9. Generate Ollama Modelfile
    if gguf_files:
        modelfile_path = os.path.join(args.output_dir, "Modelfile")
        gguf_abs = os.path.abspath(final_gguf)
        with open(modelfile_path, "w") as f:
            f.write(f'FROM {gguf_abs}\n')
            f.write('SYSTEM "You are VoiceClaw, a personalized AI assistant fine-tuned on your owner\'s coding style and preferences."\n')
            f.write('PARAMETER temperature 0.2\n')
            f.write('PARAMETER num_ctx 2048\n')
        print(f"[Evolution] Modelfile generated: {modelfile_path}")

    elapsed = time.time() - start_time

    # 10. Output metrics as JSON for the Node.js parent to parse
    metrics = {
        "finalLoss": final_loss,
        "steps": train_steps,
        "samples": len(samples),
        "durationSeconds": round(elapsed, 1),
        "quantMethod": args.quant_method,
        "outputDir": args.output_dir,
    }
    print(f"METRICS: {json.dumps(metrics)}")
    print(f"[Evolution] Pipeline complete in {elapsed:.1f}s.")


if __name__ == "__main__":
    main()
