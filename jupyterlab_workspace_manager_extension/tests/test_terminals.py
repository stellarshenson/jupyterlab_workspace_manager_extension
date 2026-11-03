"""The terminals endpoint: each terminal's name, last activity, foreground process, its directory and its command."""
import asyncio
import json
import os
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


async def new_terminal(jp_fetch, **body):
    response = await jp_fetch("api", "terminals", method="POST", body=json.dumps(body))
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


async def wait_for_cwd(jp_fetch, name, expected):
    """Poll until the terminal's cwd is `expected`; return the last value read."""
    for _ in range(100):
        cwd = {t["name"]: t["cwd"] for t in await get_terminals(jp_fetch)}[name]
        if cwd == expected:
            break
        await asyncio.sleep(0.1)
    return cwd


async def wait_for_command(jp_fetch, name, expected):
    """Poll until the terminal's command is `expected`; return the last value read."""
    for _ in range(100):
        command = {t["name"]: t["command"] for t in await get_terminals(jp_fetch)}[name]
        if command == expected:
            break
        await asyncio.sleep(0.1)
    return command


async def test_two_terminals_with_their_fields(jp_fetch, jp_serverapp):
    """ACC-SERVER-62, ACC-TERM-200: both terminals with name, last_activity and process; no fingerprint."""
    names = {await new_terminal(jp_fetch), await new_terminal(jp_fetch)}
    for name in names:
        assert await wait_for_process(jp_fetch, name, "bash") == "bash"

    terminals = await get_terminals(jp_fetch)

    assert {t["name"] for t in terminals} == names
    for terminal in terminals:
        assert set(terminal) == {"name", "last_activity", "process", "cwd", "command"}
        datetime.fromisoformat(terminal["last_activity"])
        assert terminal["process"] == "bash"


async def test_ended_terminal_left_out(jp_fetch, jp_serverapp, tmp_path):
    """ACC-TERM-200: the route leaves out a terminal whose pty has ended; a live one stays."""
    ended = await new_terminal(jp_fetch)
    live = await new_terminal(jp_fetch)
    held = tmp_path / "held"
    # a job that ignores SIGHUP holds the pty open after the shell ends, until the test removes `held`
    type_into(jp_serverapp, ended, f"(trap '' HUP; touch {held}; while [ -e {held} ]; do sleep 0.1; done) &\r")
    try:
        for _ in range(200):
            if held.exists():
                break
            await asyncio.sleep(0.1)

        response = await jp_fetch("api", "terminals", ended, method="DELETE")

        assert response.code == 204
        # terminado keeps listing the shut-down name until its pty closes
        manager = jp_serverapp.web_app.settings["terminal_manager"]
        assert ended in manager.terminals
        assert [t["name"] for t in await get_terminals(jp_fetch)] == [live]
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


async def test_cwd_follows_the_foreground_process(jp_fetch, jp_serverapp, tmp_path):
    """ACC-TERM-252-PATH-ROUTE: the terminal's real directory, then the one a cd reaches, then a foreground program's own."""
    name = await new_terminal(jp_fetch, cwd=str(tmp_path))
    assert await wait_for_process(jp_fetch, name, "bash") == "bash"

    assert await wait_for_cwd(jp_fetch, name, str(tmp_path)) == str(tmp_path)

    moved = tmp_path / "moved"
    moved.mkdir()
    type_into(jp_serverapp, name, f"cd {moved}\r")
    assert await wait_for_cwd(jp_fetch, name, str(moved)) == str(moved)

    # the shell stays in `moved` while the subshell, in the foreground, runs in /tmp
    type_into(jp_serverapp, name, "(cd /tmp && sleep 30)\r")
    assert await wait_for_cwd(jp_fetch, name, "/tmp") == "/tmp"

    type_into(jp_serverapp, name, "\x03")  # Ctrl-C ends sleep
    assert await wait_for_cwd(jp_fetch, name, str(moved)) == str(moved)


async def test_cwd_unreadable(jp_fetch, monkeypatch):
    """ACC-TERM-252-PATH-ROUTE: a failing read gives cwd null and still 200; the process is unaffected."""
    name = await new_terminal(jp_fetch)
    assert await wait_for_process(jp_fetch, name, "bash") == "bash"

    def refuse(path, *args, **kwargs):
        raise PermissionError(f"{path}: permission denied")

    monkeypatch.setattr(os, "readlink", refuse)

    terminals = await get_terminals(jp_fetch)

    assert [(t["name"], t["process"], t["cwd"]) for t in terminals] == [(name, "bash", None)]


async def test_command_is_the_foreground_command_line(jp_fetch, jp_serverapp):
    """ACC-TERM-258-COMMAND-ROUTE: the shell's command line, then a running command with its arguments, then the shell again."""
    name = await new_terminal(jp_fetch)
    assert await wait_for_process(jp_fetch, name, "bash") == "bash"
    shell = "/bin/bash --norc --noprofile"
    assert await wait_for_command(jp_fetch, name, shell) == shell

    type_into(jp_serverapp, name, "sleep 30\r")
    assert await wait_for_command(jp_fetch, name, "sleep 30") == "sleep 30"

    type_into(jp_serverapp, name, "\x03")  # Ctrl-C ends sleep
    assert await wait_for_command(jp_fetch, name, shell) == shell


def fake_cmdline(monkeypatch, read):
    """Make a read of /proc/<pgid>/cmdline return `read`, or raise it when it is an OSError."""
    read_bytes = Path.read_bytes

    def cmdline(path):
        if str(path).endswith("/cmdline"):
            if isinstance(read, OSError):
                raise read
            return read
        return read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", cmdline)


@pytest.mark.parametrize(
    ("read", "command"),
    [
        (b"bash\0-c\0sleep 120\n:\0", "bash -c sleep 120 :"),
        (b"printf\0a\r\n\t\x7f\0\0b\0", "printf a b"),
        (b"vim\0caf\xe9.md\0", "vim caf\ufffd.md"),
    ],
    ids=["newline", "run", "undecodable"],
)
async def test_command_is_one_line(jp_fetch, monkeypatch, read, command):
    """ACC-TERM-258-COMMAND-ROUTE: each run of control characters, NUL and newline included, is one space, and undecodable bytes are replacement characters."""
    name = await new_terminal(jp_fetch)
    assert await wait_for_process(jp_fetch, name, "bash") == "bash"
    fake_cmdline(monkeypatch, read)

    terminals = await get_terminals(jp_fetch)

    assert [(t["name"], t["command"]) for t in terminals] == [(name, command)]


@pytest.mark.parametrize("read", [PermissionError("/proc: permission denied"), b"", b"\0"], ids=["refused", "none", "nul"])
async def test_command_unreadable_or_empty(jp_fetch, monkeypatch, read):
    """ACC-TERM-258-COMMAND-ROUTE: a failing read or an empty command line gives command null and still 200; the process is unaffected."""
    name = await new_terminal(jp_fetch)
    assert await wait_for_process(jp_fetch, name, "bash") == "bash"
    fake_cmdline(monkeypatch, read)

    terminals = await get_terminals(jp_fetch)

    assert [(t["name"], t["process"], t["command"]) for t in terminals] == [(name, "bash", None)]


@pytest.mark.parametrize("jp_server_config", [False], indirect=True)
async def test_server_without_terminals(jp_fetch, jp_serverapp):
    """ACC-SERVER-123: terminals disabled, 200 and an empty list."""
    assert "terminal_manager" not in jp_serverapp.web_app.settings

    assert await get_terminals(jp_fetch) == []
