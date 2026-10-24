"""The terminals endpoint: each terminal's name, last activity and foreground process."""
import asyncio
import json
from datetime import datetime
from pathlib import Path

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


async def test_two_terminals_with_their_fields(jp_fetch):
    """ACC-SERVER-62: both terminals with name, last_activity and process."""
    names = {await new_terminal(jp_fetch), await new_terminal(jp_fetch)}
    for name in names:
        assert await wait_for_process(jp_fetch, name, "bash") == "bash"

    terminals = await get_terminals(jp_fetch)

    assert {t["name"] for t in terminals} == names
    for terminal in terminals:
        assert set(terminal) == {"name", "last_activity", "process"}
        datetime.fromisoformat(terminal["last_activity"])
        assert terminal["process"] == "bash"


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
