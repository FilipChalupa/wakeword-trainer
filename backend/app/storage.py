"""What takes up space in /data, and the two things that are safe to throw away (trash, feature cache)."""
from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from .config import DATA_DIR, DATASETS_DIR, FEATURE_CACHE_DIR, Project, list_projects

router = APIRouter(prefix="/api", tags=["storage"])
_cache: dict[str, Any] = {"at": 0.0, "value": None}
_lock = threading.Lock()


def dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file() and not p.is_symlink():
                total += p.stat().st_size
        except OSError:
            pass
    return total


def overview() -> dict[str, Any]:
    with _lock:
        if _cache["value"] is not None and time.time() - _cache["at"] < 20:
            return _cache["value"]
    projects = []
    for entry in list_projects():
        project = Project(entry["id"])
        trash = sum(dir_size(project.sample_dir(kind) / ".trash") for kind in ("positive", "negative"))
        recordings = sum(dir_size(project.sample_dir(kind)) for kind in ("positive", "negative")) - trash
        jobs = dir_size(project.jobs_dir)
        runs = sum(1 for d in project.jobs_dir.iterdir() if d.is_dir()) if project.jobs_dir.exists() else 0
        projects.append({"id": project.id, "name": entry.get("name") or project.id, "recordings": recordings, "trash": trash, "jobs": jobs, "runs": runs, "total": dir_size(project.dir)})
    usage = shutil.disk_usage(DATA_DIR)
    value = {
        "total": dir_size(DATA_DIR),
        "disk_free": usage.free,
        "disk_total": usage.total,
        "datasets": dir_size(DATASETS_DIR),
        "feature_cache": dir_size(FEATURE_CACHE_DIR),
        "projects": projects,
        "reclaimable": {"trash": sum(p["trash"] for p in projects), "cache": dir_size(FEATURE_CACHE_DIR)},
    }
    with _lock:
        _cache.update(at=time.time(), value=value)
    return value


def _invalidate() -> None:
    with _lock:
        _cache["value"] = None


@router.get("/storage")
def get_storage():
    return overview()


@router.post("/storage/empty-trash")
def empty_trash():
    """Deleted recordings of every project are gone for good."""
    removed = 0
    for entry in list_projects():
        project = Project(entry["id"])
        for kind in ("positive", "negative"):
            trash = project.sample_dir(kind) / ".trash"
            if trash.exists():
                removed += dir_size(trash)
                shutil.rmtree(trash, ignore_errors=True)
    _invalidate()
    return {"freed": removed}


@router.post("/storage/clear-cache")
def clear_cache():
    """Pre-computed spectrograms of the negative datasets; they are rebuilt by the next training."""
    from .jobs import manager

    if manager.is_running():
        raise HTTPException(409, {"code": "already_running", "message": "Training is running; clear the cache afterwards"})
    removed = dir_size(FEATURE_CACHE_DIR)
    if FEATURE_CACHE_DIR.exists():
        for child in FEATURE_CACHE_DIR.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
    _invalidate()
    return {"freed": removed}
