import json
from pathlib import Path
from graphify.detect import detect
from graphify.extract import collect_files, extract

root = Path(__file__).resolve().parents[1]
result = detect(root / "src")
out = root / "graphify-out"
out.mkdir(exist_ok=True)
(out / ".graphify_detect.json").write_text(json.dumps(result))
code_files = []
for f in result.get("files", {}).get("code", []):
    p = Path(f)
    code_files.extend(collect_files(p) if p.is_dir() else [p])
if code_files:
    ast = extract(code_files)
    (out / ".graphify_ast.json").write_text(json.dumps(ast, indent=2))
    print(f"AST: {len(ast['nodes'])} nodes, {len(ast['edges'])} edges from {len(code_files)} files")
else:
    print("No code files")
