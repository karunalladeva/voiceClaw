"""Graphify incremental update: AST on changed code + merge pipeline."""
import json
import sys
from pathlib import Path

from graphify.detect import detect_incremental, save_manifest
from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions, graph_diff
from graphify.report import generate
from graphify.export import to_json, to_html
from networkx.readwrite import json_graph
import networkx as nx

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "graphify-out"
INPUT_PATH = str(ROOT)


def load_json(p: Path, default=None):
    if not p.exists():
        return default if default is not None else {}
    return json.loads(p.read_text(encoding="utf-8"))


def main():
    inc = load_json(ROOT / ".graphify_incremental.json")
    if not inc:
        inc = detect_incremental(ROOT)
        (ROOT / ".graphify_incremental.json").write_text(json.dumps(inc))

    code_exts = {".py", ".ts", ".js", ".tsx", ".jsx", ".go", ".rs", ".java", ".dart", ".swift", ".kt", ".cs", ".cc", ".m"}
    all_changed = [f for files in inc.get("new_files", {}).values() for f in files]
    code_changed = [f for f in all_changed if Path(f).suffix.lower() in code_exts]

    code_files = []
    for f in code_changed:
        p = Path(f)
        code_files.extend(collect_files(p) if p.is_dir() else [p])

    if code_files:
        ast = extract(code_files)
        print(f"AST: {len(ast['nodes'])} nodes, {len(ast['edges'])} edges from {len(code_files)} files")
    else:
        ast = {"nodes": [], "edges": [], "input_tokens": 0, "output_tokens": 0}
        print("No changed code files for AST")

    cached = load_json(ROOT / ".graphify_cached.json", {"nodes": [], "edges": [], "hyperedges": []})
    sem_new = load_json(ROOT / ".graphify_semantic_new.json", {"nodes": [], "edges": [], "hyperedges": []})

    seen = {n["id"] for n in ast["nodes"]}
    merged_nodes = list(ast["nodes"])
    for n in cached.get("nodes", []) + sem_new.get("nodes", []):
        if n["id"] not in seen:
            merged_nodes.append(n)
            seen.add(n["id"])

    merged = {
        "nodes": merged_nodes,
        "edges": ast["edges"] + cached.get("edges", []) + sem_new.get("edges", []),
        "hyperedges": cached.get("hyperedges", []) + sem_new.get("hyperedges", []),
        "input_tokens": sem_new.get("input_tokens", 0),
        "output_tokens": sem_new.get("output_tokens", 0),
    }
    (ROOT / ".graphify_extract.json").write_text(json.dumps(merged, indent=2))
    print(f"Extract merged: {len(merged_nodes)} nodes, {len(merged['edges'])} edges")

    # Merge into existing graph
    G_new = build_from_json(merged)
    old_path = ROOT / "graphify-out" / "graph.json"
    if old_path.exists():
        old_data = json.loads(old_path.read_text(encoding="utf-8"))
        G_existing = json_graph.node_link_graph(old_data, edges="links")
        if (ROOT / ".graphify_old.json").exists() and not (ROOT / ".graphify_old.json").stat().st_size:
            pass
        G_existing.update(G_new)
        G = G_existing
        print(f"Merged into existing: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    else:
        G = G_new
        print(f"Fresh graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    # Rebuild from full merged extraction for clustering consistency
    # Use combined node-link from G
    communities = cluster(G)
    cohesion = score_all(G, communities)
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)
    labels = {cid: f"Community {cid}" for cid in communities}
    questions = suggest_questions(G, communities, labels)

    detection = detect_incremental(ROOT)
    tokens = {"input": merged.get("input_tokens", 0), "output": merged.get("output_tokens", 0)}
    report = generate(
        G, communities, cohesion, labels, gods, surprises, detection, tokens, INPUT_PATH,
        suggested_questions=questions,
    )
    OUT.mkdir(exist_ok=True)
    (OUT / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    to_json(G, communities, str(OUT / "graph.json"))

    analysis = {
        "communities": {str(k): v for k, v in communities.items()},
        "cohesion": {str(k): v for k, v in cohesion.items()},
        "gods": gods,
        "surprises": surprises,
        "questions": questions,
    }
    (ROOT / ".graphify_analysis.json").write_text(json.dumps(analysis, indent=2))

    if G.number_of_nodes() <= 5000:
        to_html(G, communities, str(OUT / "graph.html"), community_labels=labels)
        print("graph.html updated")

    # Diff
    old_backup = ROOT / ".graphify_old.json"
    if old_backup.exists():
        G_old = json_graph.node_link_graph(json.loads(old_backup.read_text()), edges="links")
        diff = graph_diff(G_old, G)
        print("DIFF:", diff["summary"])
        if diff.get("new_nodes"):
            print("New nodes sample:", ", ".join(n["label"] for n in diff["new_nodes"][:8]))

    save_manifest(inc.get("files", {}))
    print("Update complete.")


if __name__ == "__main__":
    main()
