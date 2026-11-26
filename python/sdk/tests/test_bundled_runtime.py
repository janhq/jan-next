"""Keyless boot tests for the production exe and development jan carrier.

Each carrier skips independently when absent. The dummy API key only satisfies
adapter loading; initialize and shutdown do not call a model.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from jan import Jan, HarnessClient, HarnessConfig
from jan_runtime import RUNTIME_MODE_ENV_VAR, resolve_bundled_launch_args

_MODES = ("exe", "node")


def _select_mode(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        resolve_bundled_launch_args(mode)
    except FileNotFoundError as exc:
        pytest.skip(f"bundled {mode}-mode runtime unavailable on this machine: {exc}")
    monkeypatch.setenv(RUNTIME_MODE_ENV_VAR, mode)


def _client(tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch, *patches: Path) -> HarnessClient:
    _select_mode(mode, monkeypatch)
    return HarnessClient(
        HarnessConfig(
            jan_home=str(tmp_path / "home"),
            patches=tuple(str(patch) for patch in patches),
            cwd=str(tmp_path),
            env={
                "TOKAMAK_API_KEY": "sk-dummy-for-boot",
                "TOKAMAK_BASE_URL": "http://127.0.0.1:9",
                "JAN_PERMISSION_MODE": "danger-full-access",
                "JAN_TELEMETRY_DISABLED": "1",
            },
            request_timeout_seconds=120,
        )
    )


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_boots_the_sdk_profile(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, mode, monkeypatch) as client:
        init = client.initialize(provider="tokamak", cwd=str(tmp_path), model="tokamak/auto")

    assert init.serverInfo is not None
    assert init.serverInfo.name == "jan-sdk-runtime"
    profile = json.loads((tmp_path / "home" / "profiles" / "sdk" / "package.json").read_text())
    assert profile["jan"]["profile"]["bundles"] == [
        "@janhq/jan-base",
        "@janhq/jan-sdk-app",
    ]


@pytest.mark.parametrize("mode", _MODES)
def test_python_sdk_applies_an_ordered_profile_patch(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _select_mode(mode, monkeypatch)
    patch = tmp_path / "persona.patch.yml"
    patch.write_text(json.dumps([{
        "id": "system-prompt",
        "config": {"persona": "Python SDK ordered patch marker."},
    }]))
    harness = Jan(
        cwd=str(tmp_path),
        jan_home=str(tmp_path / "home"),
        patches=(str(patch),),
        env={"JAN_PERMISSION_MODE": "danger-full-access"},
        api_key="sk-dummy-for-boot",
        base_url="http://127.0.0.1:9",
        request_timeout_seconds=120,
    )

    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_surfaces_required_plugin_failure(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    missing = "@janhq/jan-does-not-exist"
    patch = tmp_path / "missing.patch.yml"
    # The SDK profile has no webserver row; startup still audits it when inserted.
    patch.write_text(json.dumps([{"insert": [{"id": "webserver", "name": missing}]}]))

    _select_mode(mode, monkeypatch)
    result = subprocess.run(
        [*resolve_bundled_launch_args(), "--profile", "sdk", "--patch", str(patch)],
        cwd=tmp_path,
        env={**os.environ, "JAN_HOME": str(tmp_path / "home"), "JAN_TELEMETRY_DISABLED": "1"},
        stdin=subprocess.DEVNULL,
        capture_output=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == 1, result.stderr
    assert "webserver (required)" in result.stderr
    assert missing in result.stderr
