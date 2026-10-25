"""Presence: which workspaces other browser windows reported in the last 90 s."""
import json

import pytest
import tornado

NAMESPACE = "jupyterlab-workspace-manager-extension"
PRESENCE_FILE = "workspace-manager-presence.json"


async def report(jp_fetch, window, workspace):
    body = json.dumps({"window": window, "workspace": workspace})
    response = await jp_fetch(NAMESPACE, "presence", method="POST", body=body)
    assert response.code == 204


async def open_elsewhere(jp_fetch, window):
    response = await jp_fetch(NAMESPACE, "presence", params={"window": window})
    return json.loads(response.body)["workspaces"]


async def test_reports_count_for_90_seconds(jp_fetch, clock):
    """ACC-SERVER-64: client 2 sees client 1's workspace for 90 s; a client never sees its own."""
    await report(jp_fetch, "client-1", "X")
    await report(jp_fetch, "client-2", "V")

    assert await open_elsewhere(jp_fetch, "client-2") == ["X"]
    assert await open_elsewhere(jp_fetch, "client-1") == ["V"]

    clock[0] += 90
    assert await open_elsewhere(jp_fetch, "client-2") == ["X"]

    clock[0] += 1
    assert await open_elsewhere(jp_fetch, "client-2") == []


async def test_report_replaces_the_previous_one(jp_fetch, clock):
    """ACC-SERVER-64: client 1 reports X then Y; client 2 no longer sees X."""
    await report(jp_fetch, "client-1", "X")
    clock[0] += 30

    await report(jp_fetch, "client-1", "Y")

    assert await open_elsewhere(jp_fetch, "client-2") == ["Y"]


@pytest.mark.parametrize("body", ["[]", '{"window": "w"}', '{"window": "", "workspace": "X"}'])
async def test_bad_report_refused(jp_fetch, body):
    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(NAMESPACE, "presence", method="POST", body=body)

    assert refused.value.code == 400


async def test_reports_outlive_a_server_restart(jp_fetch, clock, custom_workspaces_dir):
    """DEF-SERVER-8: a report the server stored before a restart still counts for its 90 s."""
    # the presence file as the server before the restart left it: client 2 reported V 10 s ago
    custom_workspaces_dir.mkdir()
    reported = {"client-2": {"workspace": "V", "reported": clock[0] - 10}}
    (custom_workspaces_dir / PRESENCE_FILE).write_text(json.dumps(reported))

    assert await open_elsewhere(jp_fetch, "client-1") == ["V"]

    clock[0] += 80
    assert await open_elsewhere(jp_fetch, "client-1") == ["V"]

    clock[0] += 1
    assert await open_elsewhere(jp_fetch, "client-1") == []


async def test_reports_stored_for_the_next_server(jp_fetch, clock, custom_workspaces_dir):
    """DEF-SERVER-8: each report lands in the presence file the next server reads; expired ones leave it."""
    await report(jp_fetch, "client-1", "X")
    clock[0] += 91

    await report(jp_fetch, "client-2", "V")

    stored = json.loads((custom_workspaces_dir / PRESENCE_FILE).read_text())
    assert stored == {"client-2": {"workspace": "V", "reported": clock[0]}}
