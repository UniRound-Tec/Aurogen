from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from core.group.types import GroupRunState, GroupTranscriptEvent


def _now_ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class GroupStore:
    def __init__(self, workspace_root: Path):
        self._root = workspace_root / "group_runs"
        self._root.mkdir(parents=True, exist_ok=True)

    def _run_dir(self, run_id: str) -> Path:
        return self._root / run_id

    def _run_file(self, run_id: str) -> Path:
        return self._run_dir(run_id) / "run.json"

    def _transcript_file(self, run_id: str) -> Path:
        return self._run_dir(run_id) / "transcript.jsonl"

    def create_run(
        self,
        *,
        run_id: str,
        title: str,
        instruction: str,
        leader_provider: str,
        members: list[str],
        member_descriptions: dict[str, str],
    ) -> GroupRunState:
        run_dir = self._run_dir(run_id)
        run_dir.mkdir(parents=True, exist_ok=True)
        now = _now_ts()
        state = GroupRunState(
            run_id=run_id,
            title=title,
            status="running",
            instruction=instruction,
            leader_provider=leader_provider,
            members=members,
            member_descriptions=member_descriptions,
            agent_cursors={member: 0 for member in members},
            created_at=now,
            updated_at=now,
        )
        self.save_run(state)
        self._transcript_file(run_id).write_text("", encoding="utf-8")
        return state

    def list_runs(self) -> list[dict]:
        runs: list[dict] = []
        for run_dir in sorted(self._root.iterdir(), reverse=True) if self._root.exists() else []:
            if not run_dir.is_dir():
                continue
            run_file = run_dir / "run.json"
            if not run_file.exists():
                continue
            try:
                runs.append(json.loads(run_file.read_text(encoding="utf-8")))
            except Exception:
                continue
        runs.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return runs

    def load_run(self, run_id: str) -> GroupRunState:
        run_file = self._run_file(run_id)
        if not run_file.exists():
            raise FileNotFoundError(f"Group run '{run_id}' not found")
        data = json.loads(run_file.read_text(encoding="utf-8"))
        return GroupRunState.from_dict(data)

    def save_run(self, state: GroupRunState) -> None:
        run_file = self._run_file(state.run_id)
        run_file.parent.mkdir(parents=True, exist_ok=True)
        run_file.write_text(
            json.dumps(state.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def append_event(
        self,
        run_id: str,
        *,
        event_type: str,
        speaker: str,
        target: str,
        content: str,
        meta: dict | None = None,
    ) -> GroupTranscriptEvent:
        state = self.load_run(run_id)
        event = GroupTranscriptEvent(
            seq=state.next_seq,
            type=event_type,
            speaker=speaker,
            target=target,
            content=content,
            created_at=_now_ts(),
            meta=meta or {},
        )
        transcript_file = self._transcript_file(run_id)
        with transcript_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event.to_dict(), ensure_ascii=False) + "\n")
        state.next_seq += 1
        state.updated_at = event.created_at
        self.save_run(state)
        return event

    def read_events(self, run_id: str, *, after_seq: int = 0) -> list[dict]:
        transcript_file = self._transcript_file(run_id)
        if not transcript_file.exists():
            raise FileNotFoundError(f"Transcript for group run '{run_id}' not found")
        events: list[dict] = []
        with transcript_file.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                if int(data.get("seq", 0)) > after_seq:
                    events.append(data)
        return events
