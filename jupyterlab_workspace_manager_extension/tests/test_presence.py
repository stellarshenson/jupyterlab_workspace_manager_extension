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


async def claim(jp_fetch, window, workspace):
    body = json.dumps({"window": window, "workspace": workspace, "claim": True})
    return await jp_fetch(NAMESPACE, "presence", method="POST", body=body)


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


async def test_a_claim_stores_the_report(jp_fetch):
    """ACC-CLI-219: a claim no other live window contests stores the report as a plain report does."""
    response = await claim(jp_fetch, "client-1", "X")

    assert response.code == 204
    assert await open_elsewhere(jp_fetch, "client-2") == ["X"]


async def test_a_claim_for_a_workspace_another_window_shows_is_refused(jp_fetch):
    """ACC-CLI-219: a claim for a workspace a live window reports answers 409 and stores nothing."""
    await report(jp_fetch, "client-2", "X")

    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await claim(jp_fetch, "client-1", "X")
    assert refused.value.code == 409

    response = await jp_fetch(NAMESPACE, "presence", params={"window": "client-3"})
    assert json.loads(response.body)["windows"] == [{"window": "client-2", "workspace": "X"}]


async def test_a_plain_report_cannot_erase_a_claim(jp_fetch):
    """DEF-SERVER-55-CLAIM-RACE: a report that crosses a claim keeps the claim, so a second window is refused."""
    await claim(jp_fetch, "client-1", "X")

    await report(jp_fetch, "client-1", "V")

    assert await open_elsewhere(jp_fetch, "client-2") == ["X"]
    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await claim(jp_fetch, "client-2", "X")
    assert refused.value.code == 409


async def test_a_claim_holds_its_workspace_for_five_seconds(jp_fetch, clock):
    """DEF-SERVER-55-CLAIM-RACE-1: after its 5 s hold a claim no longer blocks a plain report, so presence follows the move."""
    await claim(jp_fetch, "client-1", "X")
    clock[0] += 6

    await report(jp_fetch, "client-1", "V")

    assert await open_elsewhere(jp_fetch, "client-2") == ["V"]


async def test_a_plain_report_stores_a_shared_workspace(jp_fetch):
    """ACC-CLI-219: the routine report stays unconditional; two windows may report one workspace."""
    await report(jp_fetch, "client-1", "X")
    await report(jp_fetch, "client-2", "X")

    response = await jp_fetch(NAMESPACE, "presence", params={"window": "client-3"})
    assert json.loads(response.body)["workspaces"] == ["X"]


@pytest.mark.parametrize(
    "body",
    ["[]", '{"window": "w"}', '{"window": "", "workspace": "X"}', '{"window": "w", "workspace": "X", "claim": "yes"}'],
)
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
