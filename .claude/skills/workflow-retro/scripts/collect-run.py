#!/usr/bin/env python3
"""Collect measured facts about a multi-agent run from the session transcripts.

Reads only what Claude Code already wrote to disk:
  ~/.claude/projects/<slug>/<session>.jsonl              — the main loop
  ~/.claude/projects/<slug>/<session>/subagents/*.jsonl  — one file per subagent

Emits markdown (default) or JSON (--json). It never estimates: a number it
cannot derive from a transcript is reported as unknown, not guessed.

Two things it deliberately does NOT do, because both would lie:
  * wall-clock span is not runtime — a resumed agent's first→last covers every
    idle hour in between, so active time is summed over bursts instead;
  * summed `input_tokens` is billing, not context size.

Usage:
  collect-run.py [--session <id|latest>] [--project <dir>] [--json]
                 [--idle-gap SECONDS] [--top N]
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys
from datetime import datetime

HOME = os.path.expanduser("~")
LAUNCH_TOOLS = ("Agent", "Task")
READ_TOOLS = ("Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit")
AGENT_ID_RE = re.compile(r"agentId[\"']?\s*[:=]\s*[\"']?([0-9a-f]{8,})")
DEFAULT_IDLE_GAP = 180.0


def project_slug(cwd):
    return cwd.replace("/", "-").replace(".", "-")


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def iter_records(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def blocks(record):
    message = record.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def text_of(block):
    body = block.get("content")
    if isinstance(body, str):
        return body
    return json.dumps(body, ensure_ascii=False) if body is not None else ""


def read_target(tool_input):
    for key in ("file_path", "path", "notebook_path"):
        value = tool_input.get(key)
        if isinstance(value, str):
            return value
    pattern = tool_input.get("pattern")
    if isinstance(pattern, str) and len(pattern) > 2:
        return f"pattern:{pattern}"
    return None


class Span:
    """One participant's measured record: tokens, tools, bursts, failures."""

    def __init__(self, key, kind=None, label=None):
        self.key = key
        self.kind = kind
        self.label = label
        self.parent = None
        self.brief_chars = None
        self.models = set()
        self.stamps = []
        self.turns = 0
        self.tokens = collections.Counter()
        self.tools = collections.Counter()
        self.reads = collections.Counter()
        self.errors = []
        self.launched = []          # (child_agent_id, kind, label, brief_chars, at)
        self.first_user_line = None

    def absorb(self, record):
        stamp = parse_ts(record.get("timestamp"))
        if stamp:
            self.stamps.append(stamp)
        message = record.get("message") or {}
        if isinstance(message, dict):
            if message.get("model"):
                self.models.add(message["model"])
            usage = message.get("usage")
            if isinstance(usage, dict):
                self.turns += 1
                for field in ("input_tokens", "output_tokens",
                              "cache_read_input_tokens", "cache_creation_input_tokens"):
                    self.tokens[field] += usage.get(field) or 0
            if self.first_user_line is None and record.get("type") == "user":
                content = message.get("content")
                raw = content if isinstance(content, str) else ""
                if not raw and isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            raw = block.get("text") or ""
                            break
                raw = " ".join(raw.split())
                if raw and not raw.startswith("<"):
                    self.first_user_line = raw[:80]

        pending = {}
        for block in blocks(record):
            kind = block.get("type")
            if kind == "tool_use":
                name = block.get("name") or "?"
                self.tools[name] += 1
                data = block.get("input") or {}
                target = read_target(data)
                if target and name in READ_TOOLS:
                    self.reads[target] += 1
                if name in LAUNCH_TOOLS:
                    pending[block.get("id")] = (
                        data.get("subagent_type") or "general-purpose",
                        data.get("description"),
                        len(data.get("prompt") or ""),
                        record.get("timestamp"),
                    )
            elif kind == "tool_result":
                if block.get("is_error"):
                    self.errors.append(" ".join(text_of(block).split())[:220])
        return pending

    # --- timing -----------------------------------------------------------
    def bursts(self, idle_gap):
        """Contiguous activity intervals, split wherever the agent went idle."""
        if not self.stamps:
            return []
        ordered = sorted(self.stamps)
        out, start, prev = [], ordered[0], ordered[0]
        for stamp in ordered[1:]:
            if (stamp - prev).total_seconds() > idle_gap:
                out.append((start, prev))
                start = stamp
            prev = stamp
        out.append((start, prev))
        return out

    def active_s(self, idle_gap):
        return sum((b - a).total_seconds() for a, b in self.bursts(idle_gap))

    @property
    def first(self):
        return min(self.stamps) if self.stamps else None

    @property
    def last(self):
        return max(self.stamps) if self.stamps else None

    def name(self):
        return self.label or self.first_user_line or self.key[:12]

    def as_dict(self, idle_gap):
        return {
            "key": self.key,
            "kind": self.kind,
            "label": self.name(),
            "parent": self.parent,
            "models": sorted(self.models),
            "first": self.first.isoformat() if self.first else None,
            "last": self.last.isoformat() if self.last else None,
            "active_s": round(self.active_s(idle_gap)),
            "bursts": len(self.bursts(idle_gap)),
            "turns": self.turns,
            "brief_chars": self.brief_chars,
            "tokens": dict(self.tokens),
            "tools": dict(self.tools),
            "errors": self.errors,
        }


def load(path, key, spans):
    span = spans.setdefault(key, Span(key))
    pending_all = {}
    for record in iter_records(path):
        pending = span.absorb(record)
        pending_all.update(pending)
        for block in blocks(record):
            if block.get("type") != "tool_result":
                continue
            launch = pending_all.pop(block.get("tool_use_id"), None)
            if not launch:
                continue
            match = AGENT_ID_RE.search(text_of(block))
            child = match.group(1) if match else None
            span.launched.append((child, *launch))
    return span


def find_session(project_dir, session):
    if session and session != "latest":
        path = os.path.join(project_dir, f"{session}.jsonl")
        if not os.path.exists(path):
            sys.exit(f"no transcript at {path}")
        return path
    files = [os.path.join(project_dir, f) for f in os.listdir(project_dir)
             if f.endswith(".jsonl") and os.path.isfile(os.path.join(project_dir, f))]
    if not files:
        sys.exit(f"no session transcripts under {project_dir}")
    return max(files, key=os.path.getmtime)


def collect(project_dir, session):
    main_path = find_session(project_dir, session)
    session_id = os.path.basename(main_path)[: -len(".jsonl")]

    spans = {}
    main = load(main_path, "main", spans)
    main.kind, main.label = "main", "main loop"

    sub_dir = os.path.join(project_dir, session_id, "subagents")
    if os.path.isdir(sub_dir):
        for name in sorted(os.listdir(sub_dir)):
            if not name.endswith(".jsonl"):
                continue
            key = name[len("agent-"):-len(".jsonl")] if name.startswith("agent-") else name[:-6]
            load(os.path.join(sub_dir, name), key, spans)

    # Attribute every child to the parent that launched it.
    timeline = []
    for parent in spans.values():
        for child, kind, label, brief, at in parent.launched:
            timeline.append({"at": at, "parent": parent.key, "child": child,
                             "kind": kind, "label": label, "brief_chars": brief})
            target = spans.get(child)
            if target:
                target.kind = target.kind or kind
                target.label = target.label or label
                target.parent = parent.key
                target.brief_chars = brief
    timeline.sort(key=lambda e: e["at"] or "")

    ordered = [main] + sorted((s for s in spans.values() if s.key != "main"),
                              key=lambda s: s.first or datetime.max)
    return {"session_id": session_id, "transcript": main_path,
            "spans": ordered, "timeline": timeline, "by_key": spans}


def overlaps(spans, idle_gap):
    """Agents genuinely in flight at the same time — bursts, not idle spans."""
    found = []
    for i, a in enumerate(spans):
        for b in spans[i + 1:]:
            total = 0.0
            for a0, a1 in a.bursts(idle_gap):
                for b0, b1 in b.bursts(idle_gap):
                    total += max(0.0, (min(a1, b1) - max(a0, b0)).total_seconds())
            if total > 0:
                found.append((a, b, total))
    return sorted(found, key=lambda t: -t[2])


def duplicated_reads(spans, minimum=2):
    owners = collections.defaultdict(set)
    for span in spans:
        for target in span.reads:
            owners[target].add(span.name())
    return sorted(((t, sorted(o)) for t, o in owners.items() if len(o) >= minimum),
                  key=lambda kv: (-len(kv[1]), kv[0]))


def num(value):
    return f"{value:,}".replace(",", " ")


def dur(seconds):
    if not seconds:
        return "—"
    return f"{seconds/60:.0f}m" if seconds >= 60 else f"{seconds:.0f}s"


def render(data, idle_gap, top):
    spans = data["spans"]
    subs = [s for s in spans if s.key != "main"]
    out = [
        "# Workflow run — measured facts", "",
        f"Session `{data['session_id']}`",
        f"Transcript `{data['transcript']}`", "",
        "Every number here is read from the transcripts on disk. Nothing is recalled.", "",
        "## Participants", "",
        "| agent | kind | parent | first | active | bursts | turns | out tok | cache read | tools | brief |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for span in spans:
        out.append("| {name} | {kind} | {parent} | {first} | {active} | {bursts} | {turns} | {o} | {c} | {t} | {b} |".format(
            name=span.name(), kind=span.kind or "—",
            parent=(span.parent or "—")[:8],
            first=span.first.strftime("%m-%d %H:%M") if span.first else "—",
            active=dur(span.active_s(idle_gap)), bursts=len(span.bursts(idle_gap)),
            turns=span.turns, o=num(span.tokens["output_tokens"]),
            c=num(span.tokens["cache_read_input_tokens"]), t=sum(span.tools.values()),
            b=num(span.brief_chars) if span.brief_chars else "—"))

    total_out = sum(s.tokens["output_tokens"] for s in spans)
    sub_out = sum(s.tokens["output_tokens"] for s in subs)
    share = f"{100 * sub_out / total_out:.0f}%" if total_out else "—"
    out += ["",
            f"**Totals** — output {num(total_out)} · cache read "
            f"{num(sum(s.tokens['cache_read_input_tokens'] for s in spans))} · "
            f"agents {len(subs)} · subagent share of output {share} · "
            f"active {dur(sum(s.active_s(idle_gap) for s in spans))}.", "",
            f"Active time sums bursts, splitting wherever a participant idled over "
            f"{idle_gap:.0f}s. Wall-clock spans would count the gaps and are not reported.",
            "", "## Launch order", ""]

    for entry in data["timeline"]:
        stamp = (entry["at"] or "")[5:19].replace("T", " ")
        parent = "main" if entry["parent"] == "main" else entry["parent"][:8]
        out.append(f"- `{stamp}` **{entry['kind']}** — {entry['label'] or '—'} "
                   f"· spawned by {parent} · brief {num(entry['brief_chars'])} chars")
    if not data["timeline"]:
        out.append("- No subagent was launched in this session.")

    out += ["", "## Concurrency", ""]
    pairs = overlaps(subs, idle_gap)
    if pairs:
        for a, b, secs in pairs[:top]:
            out.append(f"- {a.name()} ‖ {b.name()} — {dur(secs)} in flight together")
    else:
        out.append("- None. Every agent ran alone: this was a pipeline, not a fan-out.")

    out += ["", "## Duplicated reading", "",
            "*A file opened by more than one agent is context that could have been "
            "passed down instead of re-derived.*", ""]
    dupes = duplicated_reads(subs)
    if dupes:
        for target, owners in dupes[:top]:
            out.append(f"- `{target}` — {len(owners)}×: {', '.join(owners)}")
    else:
        out.append("- No file was opened by more than one agent.")

    out += ["", "## Failures and refusals", ""]
    seen = collections.Counter()
    for span in spans:
        for err in span.errors:
            seen[(span.name(), err[:180])] += 1
    if seen:
        for (who, err), count in seen.most_common(top):
            out.append(f"- **{who}** ×{count} — {err}")
    else:
        out.append("- No tool call returned an error.")

    out += ["", "## Tool profile", ""]
    for span in spans:
        if span.tools:
            out.append(f"- **{span.name()}** — " +
                       " · ".join(f"{k} {v}" for k, v in span.tools.most_common(8)))
    out.append("")
    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", default="latest")
    parser.add_argument("--project", default=os.getcwd())
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--idle-gap", type=float, default=DEFAULT_IDLE_GAP)
    parser.add_argument("--top", type=int, default=12)
    args = parser.parse_args()

    project_dir = os.path.join(HOME, ".claude", "projects",
                               project_slug(os.path.abspath(args.project)))
    if not os.path.isdir(project_dir):
        sys.exit(f"no transcripts for this project at {project_dir}")

    data = collect(project_dir, args.session)
    if args.json:
        print(json.dumps({
            "session_id": data["session_id"],
            "transcript": data["transcript"],
            "idle_gap_s": args.idle_gap,
            "participants": [s.as_dict(args.idle_gap) for s in data["spans"]],
            "timeline": data["timeline"],
            "duplicated_reads": duplicated_reads([s for s in data["spans"] if s.key != "main"]),
        }, indent=2, ensure_ascii=False))
    else:
        print(render(data, args.idle_gap, args.top))


if __name__ == "__main__":
    main()
