import json
from pathlib import Path
from graphify.extract import collect_files, extract

root = Path(__file__).resolve().parents[1]
inc = json.loads((root / ".graphify_incremental.json").read_text(encoding="utf-8"))
code_exts = {".py", ".ts", ".js", ".tsx", ".jsx", ".go", ".rs", ".java", ".dart", ".swift", ".kt", ".cs", ".cc", ".m"}
all_changed = [f for files in inc.get("new_files", {}).values() for f in files]
code_changed = [f for f in all_changed if Path(f).suffix.lower() in code_exts]
code_files = []
for f in code_changed:
    p = Path(f)
    code_files.extend(collect_files(p) if p.is_dir() else [p])
print(f"Changed code: {len(code_changed)} paths -> {len(code_files)} files")
if code_files:
    ast = extract(code_files)
    (root / ".graphify_ast.json").write_text(json.dumps(ast, indent=2))
    print(f"AST: {len(ast['nodes'])} nodes, {len(ast['edges'])} edges")
else:
    (root / ".graphify_ast.json").write_text(json.dumps({"nodes": [], "edges": [], "input_tokens": 0, "output_tokens": 0}))
