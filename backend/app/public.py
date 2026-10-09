"""Token-protected public endpoints (no Basic auth): latest model/manifest for ESPHome `model: <url>` and
wake-word events posted by ESPHome devices (`on_wake_word_detected` → http_request)."""
from __future__ import annotations

import json
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from .config import Project, current_project, find_project_by_model_token, get_or_create_model_token, load_settings, slugify

router = APIRouter(prefix="/api", tags=["public"])

MIN_ESPHOME = "2024.7.0"
_device_events: dict[str, deque[dict[str, Any]]] = {}
_lock = threading.Lock()


def _project(token: str) -> Project:
    project = find_project_by_model_token(token)
    if project is None:
        raise HTTPException(403, {"code": "bad_token", "message": "Unknown model token"})
    return project


TARGETS = ("esphome", "wyoming")


def latest_done_job(project: Project, target: str | None = None) -> dict[str, Any] | None:
    """Newest finished run with a model; `target` narrows it to one platform (an ESP must never get a Wyoming model)."""
    from .jobs import list_jobs

    for job in list_jobs(project):
        if job["status"] == "done" and job["model_url"] and (target is None or job.get("target", "esphome") == target):
            return job
    return None


def default_target(project: Project) -> str:
    target = load_settings(project)["training"].get("target", "esphome")
    return target if target in TARGETS else "esphome"


def public_base(request: Request) -> str:
    import os

    base = os.environ.get("PUBLIC_URL", "").rstrip("/")
    if base:
        return base
    return str(request.base_url).rstrip("/")


def public_urls(request: Request, project: Project) -> dict[str, str]:
    token = get_or_create_model_token(project)
    base = public_base(request)
    return {
        "token": token,
        "manifest_url": f"{base}/api/public/{token}/manifest.json",
        "model_url": f"{base}/api/public/{token}/model.tflite",
        "wyoming_model_url": f"{base}/api/public/{token}/model.tflite?target=wyoming",
        "device_event_url": f"{base}/api/public/{token}/device-event",
    }


def esphome_url_snippet(urls: dict[str, str], wake_word: str, slug: str) -> str:
    return f"""# ESPHome: load the latest "{wake_word}" model straight from Wake Word Trainer (re-flash after each retraining)
http_request:
  verify_ssl: false

micro_wake_word:
  models:
    - model: {urls['manifest_url']}
  on_wake_word_detected:
    - logger.log:
        format: "Wake word detected: %s"
        args: ['x.c_str()']
    # optional: report every detection back to the trainer's device test timeline
    - http_request.post:
        url: {urls['device_event_url']}
        request_headers:
          Content-Type: application/json
        body: !lambda |-
          return "{{\\"device\\": \\"" + App.get_name() + "\\", \\"wake_word\\": \\"" + x + "\\", \\"esphome_version\\": \\"" + std::string(ESPHOME_VERSION) + "\\"}}";
"""


def version_tuple(text: str) -> tuple[int, ...]:
    parts = []
    for piece in str(text).split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts[:3])


@router.get("/projects/{pid}/public-urls")
def get_public_urls(pid: str, request: Request):
    from .config import get_project
    from .export import wyoming_readme

    try:
        project = get_project(pid)
    except KeyError:
        raise HTTPException(404, {"code": "not_found", "message": "Project not found"}) from None
    settings = load_settings(project)
    urls = public_urls(request, project)
    targets: dict[str, dict[str, Any]] = {}
    for target in TARGETS:
        job = latest_done_job(project, target)
        slug = job["slug"] if job else slugify(settings["wake_word"])
        if target == "wyoming":
            url = urls["wyoming_model_url"]
            snippet = wyoming_readme(slug, settings["wake_word"]) + f"\nDirect download of the latest Wyoming model: {url}\n"
        else:
            url = urls["manifest_url"]
            snippet = esphome_url_snippet(urls, settings["wake_word"], slug)
        targets[target] = {"has_model": job is not None, "job_id": job["job_id"] if job else None, "finished_at": job["finished_at"] if job else None, "slug": slug, "url": url, "snippet": snippet}
    default = default_target(project)
    return {
        **urls,
        "default_target": default,
        "targets": targets,
        "has_model": any(v["has_model"] for v in targets.values()),
        "minimum_esphome_version": MIN_ESPHOME,
        # legacy fields of the default platform
        "job_id": targets[default]["job_id"],
        "target": default,
        "slug": targets[default]["slug"],
        "snippet": targets[default]["snippet"],
    }


@router.get("/public/{token}/manifest.json")
def public_manifest(token: str, request: Request):
    project = _project(token)
    job = latest_done_job(project, "esphome")
    if not job:
        raise HTTPException(404, {"code": "no_models", "message": "No trained ESPHome (microWakeWord) model yet"})
    job_dir = project.jobs_dir / job["job_id"]
    manifest_path = job_dir / f"{job['slug']}.json"
    if not manifest_path.exists():
        raise HTTPException(404, {"code": "no_manifest", "message": "The latest ESPHome model has no manifest"})
    manifest = json.loads(manifest_path.read_text())
    manifest["model"] = f"{public_base(request)}/api/public/{token}/model.tflite?target=esphome"
    return JSONResponse(manifest, headers={"Cache-Control": "no-cache"})


@router.get("/public/{token}/model.tflite")
def public_model(token: str, target: str | None = None):
    """Latest model of one platform. Without `target` (links copied before platforms were separate) the project's default platform."""
    project = _project(token)
    if target is not None and target not in TARGETS:
        raise HTTPException(400, {"code": "bad_target", "message": "target must be esphome or wyoming"})
    job = latest_done_job(project, target or default_target(project))
    if not job:
        raise HTTPException(404, {"code": "no_models", "message": "No trained model for this platform yet"})
    path = project.jobs_dir / job["job_id"] / f"{job['slug']}.tflite"
    return FileResponse(path, media_type="application/octet-stream", filename=path.name, headers={"Cache-Control": "no-cache"})


@router.post("/public/{token}/device-event")
async def device_event(token: str, request: Request):
    project = _project(token)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}
    event = {
        "at": datetime.now(timezone.utc).isoformat(),
        "device": str(body.get("device") or request.client.host if request.client else "device")[:64],
        "wake_word": str(body.get("wake_word") or "")[:64],
        "esphome_version": str(body.get("esphome_version") or "")[:32],
        "probability": body.get("probability"),
    }
    with _lock:
        _device_events.setdefault(project.id, deque(maxlen=500)).append(event)
    return PlainTextResponse("ok")


@router.get("/monitor/device-events")
def get_device_events(since: str | None = None):
    project = current_project()
    with _lock:
        events = list(_device_events.get(project.id, []))
    if since:
        events = [e for e in events if e["at"] > since]
    outdated = sorted({e["esphome_version"] for e in events if e["esphome_version"] and version_tuple(e["esphome_version"]) < version_tuple(MIN_ESPHOME)})
    return {"items": events[-200:], "minimum_esphome_version": MIN_ESPHOME, "outdated_versions": outdated, "now": datetime.now(timezone.utc).isoformat()}


@router.get("/bundle")
def bundle(request: Request, projects: str = ""):
    """ZIP with the latest model of each platform per project: ESPHome .tflite + .json with one YAML listing all of them,
    Wyoming .tflite files under wyoming/ with a README."""
    import io
    import zipfile

    from fastapi.responses import StreamingResponse

    from .config import get_project, list_projects
    from .export import wyoming_readme

    ids = [p for p in projects.split(",") if p] or [p["id"] for p in list_projects()]
    buffer = io.BytesIO()
    models_yaml = []
    wyoming_readmes = []
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for pid in ids:
            try:
                project = get_project(pid)
            except KeyError:
                continue
            job = latest_done_job(project, "esphome")
            if job:
                job_dir = project.jobs_dir / job["job_id"]
                slug = job["slug"]
                zf.write(job_dir / f"{slug}.tflite", f"{slug}.tflite")
                if (job_dir / f"{slug}.json").exists():
                    zf.write(job_dir / f"{slug}.json", f"{slug}.json")
                models_yaml.append(f"    - model: {slug}.json   # {job['wake_word']}")
            job = latest_done_job(project, "wyoming")
            if job:
                job_dir = project.jobs_dir / job["job_id"]
                slug = job["slug"]
                zf.write(job_dir / f"{slug}.tflite", f"wyoming/{slug}.tflite")
                wyoming_readmes.append(wyoming_readme(slug, job["wake_word"]))
        if not models_yaml and not wyoming_readmes:
            raise HTTPException(404, {"code": "no_models", "message": "No trained models to bundle"})
        if models_yaml:
            yaml_text = "# Several wake words on one ESPHome device – copy the .tflite/.json files next to this YAML.\nmicro_wake_word:\n  models:\n" + "\n".join(models_yaml) + "\n  on_wake_word_detected:\n    - logger.log:\n        format: \"Wake word detected: %s\"\n        args: ['x.c_str()']\n"
            zf.writestr("esphome-wake-words.yaml", yaml_text)
        if wyoming_readmes:
            zf.writestr("wyoming/README.txt", "\n\n".join(wyoming_readmes))
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="wake-words-bundle.zip"'})
