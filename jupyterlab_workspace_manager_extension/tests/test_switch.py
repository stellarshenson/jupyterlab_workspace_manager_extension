"""The switch channel: CLI requests the panel windows read once and that expire."""
import json

import pytest
import tornado

NAMESPACE = "jupyterlab-workspace-manager-extension"
SWITCH_FILE = "workspace-manager-switch.json"


async def put_workspace(jp_fetch, name):
    body = json.dumps({"data": {}, "metadata": {"id": name}})
    await jp_fetch("lab", "api", "workspaces", name, method="PUT", body=body)


async def record(jp_fetch, **request):
    return await jp_fetch(NAMESPACE, "switch", method="POST", body=json.dumps(request))


async def read(jp_fetch, window):
    response = await jp_fetch(NAMESPACE, "switch", params={"window": window})
    return json.loads(response.body)["requests"]


async def report_presence(jp_fetch, window, workspace):
    await jp_fetch(NAMESPACE, "presence", method="POST", body=json.dumps({"window": window, "workspace": workspace}))


async def test_a_request_reaches_every_window_once(jp_fetch):
    """ACC-CLI-219: a request with no window id comes to each window once; a window that read it never sees it again."""
    await put_workspace(jp_fetch, "one")
    await record(jp_fetch, workspace="one")

    assert await read(jp_fetch, "w1") == [{"workspace": "one", "tab": None}]
    assert await read(jp_fetch, "w1") == []
    assert await read(jp_fetch, "w2") == [{"workspace": "one", "tab": None}]
    assert await read(jp_fetch, "w2") == []


async def test_a_broadcast_reaches_only_the_windows_live_at_the_command(jp_fetch):
    """DEF-SERVER-57-SWITCH-REPLAY: a window opened after the command reads nothing."""
    await put_workspace(jp_fetch, "one")
    await report_presence(jp_fetch, "w1", "one")
    await record(jp_fetch, workspace="one")

    assert await read(jp_fetch, "w1") == [{"workspace": "one", "tab": None}]
    # w2 never reported presence, so its window opened after the request was posted
    assert await read(jp_fetch, "w2") == []


async def test_requests_are_delivered_in_the_order_they_were_posted(jp_fetch, clock, custom_workspaces_dir):
    """The panel applies pending requests in read order, so the read sorts by created, not by the file's uuid order."""
    await put_workspace(jp_fetch, "one")
    await put_workspace(jp_fetch, "two")
    # the file sorts by uuid: the later-created request is written first
    stored = {
        "ffff": {"workspace": "two", "created": clock[0] - 1, "delivered": []},
        "0000": {"workspace": "one", "created": clock[0] - 2, "delivered": []},
    }
    (custom_workspaces_dir / SWITCH_FILE).write_text(json.dumps(stored))

    assert [request["workspace"] for request in await read(jp_fetch, "w1")] == ["one", "two"]


async def test_a_window_id_restricts_the_request(jp_fetch):
    """ACC-CLI-219: --window names one window; no other window reads the request."""
    await put_workspace(jp_fetch, "one")
    await report_presence(jp_fetch, "w1", "one")
    await record(jp_fetch, workspace="one", window="w1")

    assert await read(jp_fetch, "w2") == []
    assert await read(jp_fetch, "w1") == [{"workspace": "one", "tab": None}]


async def test_an_unknown_window_is_refused(jp_fetch):
    """ACC-CLI-225: a window id no live presence report carries answers 404 and nothing is stored."""
    await put_workspace(jp_fetch, "one")

    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await record(jp_fetch, workspace="one", window="typo")

    assert refused.value.code == 404
    assert await read(jp_fetch, "w1") == []


async def test_presence_lists_live_windows(jp_fetch):
    """ACC-CLI-225: presence lists each live window with its workspace, beside the workspaces the other windows show."""
    await report_presence(jp_fetch, "w1", "alpha")
    await report_presence(jp_fetch, "w2", "beta")

    response = await jp_fetch(NAMESPACE, "presence", params={"window": "w1"})
    body = json.loads(response.body)

    assert body["workspaces"] == ["beta"]
    assert body["windows"] == [
        {"window": "w1", "workspace": "alpha"},
        {"window": "w2", "workspace": "beta"},
    ]


async def test_a_tab_request_carries_its_path(jp_fetch):
    """ACC-CLI-220: a tab request names the tab path, with or without the workspace to switch to first."""
    await put_workspace(jp_fetch, "one")

    await record(jp_fetch, workspace="one", tab="a.ipynb")
    assert await read(jp_fetch, "w1") == [{"workspace": "one", "tab": "a.ipynb"}]

    await record(jp_fetch, tab="b.md")
    assert await read(jp_fetch, "w1") == [{"workspace": None, "tab": "b.md"}]


async def test_a_request_waits_ninety_seconds(jp_fetch, clock):
    """ACC-CLI-219: a request created 90 s ago is still delivered, outliving a background tab's one-minute timer."""
    await put_workspace(jp_fetch, "one")
    await record(jp_fetch, workspace="one")

    clock[0] += 90

    assert await read(jp_fetch, "w1") == [{"workspace": "one", "tab": None}]


async def test_an_unread_request_expires(jp_fetch, clock):
    """ACC-CLI-219: a request no window read within 90 s is gone, so a dead window cannot replay it."""
    await put_workspace(jp_fetch, "one")
    await record(jp_fetch, workspace="one")

    clock[0] += 91

    assert await read(jp_fetch, "w1") == []


async def test_a_deleted_workspace_is_not_delivered(jp_fetch):
    """ACC-CLI-219: a workspace deleted after its request was posted is not reopened; the request is skipped, not read."""
    await put_workspace(jp_fetch, "one")
    await record(jp_fetch, workspace="one")
    await jp_fetch("lab", "api", "workspaces", "one", method="DELETE")

    assert await read(jp_fetch, "w1") == []
    assert await read(jp_fetch, "w1") == []

    # the file is back: the request waited unread, so it still reaches the window
    await put_workspace(jp_fetch, "one")
    assert await read(jp_fetch, "w1") == [{"workspace": "one", "tab": None}]


async def test_an_unknown_workspace_is_refused(jp_fetch):
    """ACC-CLI-219: a name no workspace file carries answers 404 and nothing is stored."""
    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await record(jp_fetch, workspace="typo")

    assert refused.value.code == 404
    assert await read(jp_fetch, "w1") == []


@pytest.mark.parametrize(
    "body",
    [
        "[]",
        '{"workspace": ""}',
        '{"workspace": 4}',
        '{"workspace": "one", "tab": ""}',
        '{"workspace": "one", "tab": null}',
        '{"workspace": "one", "window": 4}',
    ],
)
async def test_bad_request_refused(jp_fetch, body):
    await put_workspace(jp_fetch, "one")

    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(NAMESPACE, "switch", method="POST", body=body)

    assert refused.value.code == 400


async def test_a_read_needs_a_window(jp_fetch):
    """ACC-CLI-219: without a window id there is no window to mark the request delivered to."""
    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(NAMESPACE, "switch")

    assert refused.value.code == 400
