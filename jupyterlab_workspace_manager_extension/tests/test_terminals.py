"""The terminals endpoint: each terminal's name, last activity and foreground process."""
import asyncio
import json
from datetime import datetime
from pathlib import Path

import psutil
import pytest

NAMESPACE = "jupyterlab-workspace-manager-extension"


@pytest.fixture
def jp_server_config(jp_server_config, request):
    server = {
        **jp_server_config["ServerApp"],
        # bash without startup files, so the shell's process name is known
        "terminado_settings": {"shell_command": ["/bin/bash", "--norc", "--noprofile"]},
        "terminals_enabled": getattr(request, "param", True),
    }
    return {**jp_server_config, "ServerApp": server}


async def get_terminals(jp_fetch):
    response = await jp_fetch(NAMESPACE, "terminals")
    assert response.code == 200
    return json.loads(response.body)


async def new_terminal(jp_fetch):
    response = await jp_fetch("api", "terminals", method="POST", body="{}")
    return json.loads(response.body)["name"]


def type_into(jp_serverapp, name, text):
    jp_serverapp.web_app.settings["terminal_manager"].get_terminal(name).ptyproc.write(text)


async def wait_for_process(jp_fetch, name, expected):
    """Poll until the terminal's process is `expected`; return the last value read."""
    for _ in range(100):
        process = {t["name"]: t["process"] for t in await get_terminals(jp_fetch)}[name]
        if process == expected:
            break
        await asyncio.sleep(0.1)
    return process


async def test_two_terminals_with_their_fields(jp_fetch, jp_serverapp):
    """ACC-SERVER-62, ACC-TERM-200: both terminals with name, last_activity, process and pty fingerprint."""
    names = {await new_terminal(jp_fetch), await new_terminal(jp_fetch)}
    for name in names:
        assert await wait_for_process(jp_fetch, name, "bash") == "bash"

    terminals = await get_terminals(jp_fetch)

    manager = jp_serverapp.web_app.settings["terminal_manager"]
    assert {t["name"] for t in terminals} == names
    for terminal in terminals:
        assert set(terminal) == {"name", "last_activity", "process", "fingerprint"}
        datetime.fromisoformat(terminal["last_activity"])
        assert terminal["process"] == "bash"
        pid = manager.terminals[terminal["name"]].ptyproc.pid
        assert terminal["fingerprint"] == f"{pid}:{psutil.Process(pid).create_time()}"
    assert len({t["fingerprint"] for t in terminals}) == 2


async def test_reused_name_gets_another_fingerprint(jp_fetch):
    """ACC-TERM-200: a new terminal that takes a shut-down terminal's name has another fingerprint."""
    name = await new_terminal(jp_fetch)
    [old] = await get_terminals(jp_fetch)
    await jp_fetch("api", "terminals", name, method="DELETE")
    # the server lists a shut-down terminal until its pty closes
    for _ in range(200):
        if not await get_terminals(jp_fetch):
            break
        await asyncio.sleep(0.1)

    assert await new_terminal(jp_fetch) == name
    [new] = await get_terminals(jp_fetch)
    assert new["fingerprint"] != old["fingerprint"]


async def test_fingerprint_without_start_time(jp_fetch, jp_serverapp, monkeypatch):
    """ACC-TERM-200: the bare pid when the start time cannot be read."""
    name = await new_terminal(jp_fetch)

    def refuse(pid):
        raise psutil.AccessDenied(pid)

    monkeypatch.setattr(psutil, "Process", refuse)

    [terminal] = await get_terminals(jp_fetch)
    pid = jp_serverapp.web_app.settings["terminal_manager"].terminals[name].ptyproc.pid
    assert terminal["fingerprint"] == str(pid)


async def test_fingerprint_kept_while_listed_after_delete(jp_fetch, jp_serverapp, tmp_path):
    """ACC-TERM-200: the server lists a shut-down terminal until its pty closes, with the same fingerprint."""
    name = await new_terminal(jp_fetch)
    pid = jp_serverapp.web_app.settings["terminal_manager"].terminals[name].ptyproc.pid
    held = tmp_path / "held"
    # a job that ignores SIGHUP holds the pty open after the shell ends, until the test removes `held`
    type_into(jp_serverapp, name, f"(trap '' HUP; touch {held}; while [ -e {held} ]; do sleep 0.1; done) &\r")
    try:
        for _ in range(200):
            if held.exists():
                break
            await asyncio.sleep(0.1)
        [before] = await get_terminals(jp_fetch)

        response = await jp_fetch("api", "terminals", name, method="DELETE")

        assert response.code == 204
        # terminado reaps the shell before the 204, so its start time can no longer be read
        assert not psutil.pid_exists(pid)
        for _ in range(3):
            listed = [(t["name"], t["fingerprint"]) for t in await get_terminals(jp_fetch)]
            assert listed == [(name, before["fingerprint"])]
            await asyncio.sleep(0.1)
    finally:
        held.unlink(missing_ok=True)


async def test_process_at_the_prompt_is_the_shell(jp_fetch):
    """ACC-TERM-43: a new terminal with /bin/bash reads bash."""
    name = await new_terminal(jp_fetch)

    assert await wait_for_process(jp_fetch, name, "bash") == "bash"


async def test_process_follows_the_program(jp_fetch, jp_serverapp):
    """ACC-TERM-42, ACC-TERM-113: sleep while it runs, the shell again after it ends."""
    name = await new_terminal(jp_fetch)
    assert await wait_for_process(jp_fetch, name, "bash") == "bash"

    type_into(jp_serverapp, name, "sleep 30\r")
    assert await wait_for_process(jp_fetch, name, "sleep") == "sleep"

    type_into(jp_serverapp, name, "\x03")  # Ctrl-C ends sleep
    assert await wait_for_process(jp_fetch, name, "bash") == "bash"


async def test_process_unreadable(jp_fetch, monkeypatch):
    """ACC-TERM-44: a failing /proc read gives process null and still 200."""
    name = await new_terminal(jp_fetch)
    read_text = Path.read_text

    def refuse_proc(path, *args, **kwargs):
        if str(path).startswith("/proc/"):
            raise PermissionError(f"{path}: permission denied")
        return read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", refuse_proc)

    terminals = await get_terminals(jp_fetch)

    assert [(t["name"], t["process"]) for t in terminals] == [(name, None)]


@pytest.mark.parametrize("jp_server_config", [False], indirect=True)
async def test_server_without_terminals(jp_fetch, jp_serverapp):
    """ACC-SERVER-123: terminals disabled, 200 and an empty list."""
    assert "terminal_manager" not in jp_serverapp.web_app.settings

    assert await get_terminals(jp_fetch) == []
