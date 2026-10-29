import asyncio
import json
import subprocess
import sys

import psutil
import pytest

NAMESPACE = "jupyterlab-workspace-manager-extension"


@pytest.fixture
def jp_server_config(jp_server_config):
    # A server that lets undecorated handlers through, so each 403 below comes from the route's own decorator
    return {**jp_server_config, "ServerApp": {**jp_server_config["ServerApp"], "allow_unauthenticated_access": True}}


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("GET", "terminals", None),
        ("GET", "kernels", None),
        ("GET", "meta", None),
        ("PATCH", "meta/one", '{"hidden": true}'),
        ("GET", "presence?window=w", None),
        ("POST", "presence", '{"window": "w", "workspace": "one"}'),
        ("GET", "switch?window=w", None),
        ("POST", "switch", '{"workspace": "one"}'),
    ],
)
async def test_route_without_token_answers_403(http_server_client, jp_base_url, method, path, body):
    """ACC-SERVER-63: no token, 403; the matching XSRF cookie and header keep the XSRF check out of it."""
    response = await http_server_client.fetch(
        f"{jp_base_url}jupyterlab-workspace-manager-extension/{path}",
        method=method,
        body=body,
        headers={"Cookie": "_xsrf=same", "X-XSRFToken": "same"},
        raise_error=False,
    )

    assert response.code == 403


async def new_kernel(jp_fetch):
    response = await jp_fetch("api", "kernels", method="POST", body="{}")
    return json.loads(response.body)["id"]


async def get_resources(jp_fetch):
    response = await jp_fetch(NAMESPACE, "kernels")
    assert response.code == 200
    return json.loads(response.body)


async def test_kernel_memory_and_cpu(jp_fetch):
    """ACC-SERVER-197: a started kernel has memory above 0 and a CPU number, at the first read and the second."""
    kernel = await new_kernel(jp_fetch)

    for _ in range(2):  # the first cpu_percent() of a process reads 0.0, the second a measured figure
        resources = (await get_resources(jp_fetch))[kernel]
        assert resources["memory"] > 0
        assert isinstance(resources["cpu"], float) and resources["cpu"] >= 0


async def test_kernel_process_gone(jp_fetch, monkeypatch):
    """ACC-SERVER-197: a kernel whose process cannot be read gets null for both, and still 200."""
    kernel = await new_kernel(jp_fetch)

    def gone(pid):
        raise psutil.NoSuchProcess(pid)

    monkeypatch.setattr(psutil, "Process", gone)

    assert (await get_resources(jp_fetch))[kernel] == {"memory": None, "cpu": None}


async def test_kernel_without_local_process(jp_fetch, jp_serverapp, monkeypatch):
    """ACC-SERVER-197: a kernel whose provisioner has no local process, as a remote one, gets null for both."""
    kernel = await new_kernel(jp_fetch)
    monkeypatch.setattr(jp_serverapp.kernel_manager.get_kernel(kernel).provisioner, "process", None)

    assert (await get_resources(jp_fetch))[kernel] == {"memory": None, "cpu": None}


async def test_kernel_cpu_counts_children(jp_fetch, jp_serverapp, monkeypatch):
    """ACC-SERVER-197: the CPU figure counts the kernel's child processes, as the memory figure does."""
    kernel = await new_kernel(jp_fetch)
    # an idle parent that starts a busy child and then reports on stdout
    script = (
        "import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', 'while True: pass']); "
        "print(flush=True); time.sleep(60)"
    )
    parent = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE)
    try:
        parent.stdout.readline()
        monkeypatch.setattr(jp_serverapp.kernel_manager.get_kernel(kernel).provisioner, "process", parent)
        await get_resources(jp_fetch)  # the first cpu_percent() of a process reads 0.0
        await asyncio.sleep(1)

        assert (await get_resources(jp_fetch))[kernel]["cpu"] > 50
    finally:
        for child in psutil.Process(parent.pid).children(recursive=True):
            child.kill()
        parent.kill()
        parent.wait()
