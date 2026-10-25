"""The records file: purpose, colour and hidden state per workspace, beside the workspaces."""
import asyncio
import json
import logging
import os

import pytest
import tornado

NAMESPACE = "jupyterlab-workspace-manager-extension"
RECORDS_FILE = "workspace-manager.json"
LAST_COLOUR = "/last-colour"
RECORD = {"purpose": "Review the feedback", "colour": "mint", "hidden": True}


async def put_workspace(jp_fetch, name):
    body = json.dumps({"data": {}, "metadata": {"id": name}})
    await jp_fetch("lab", "api", "workspaces", name, method="PUT", body=body)


async def patch(jp_fetch, name, change):
    response = await jp_fetch(NAMESPACE, "meta", name, method="PATCH", body=json.dumps(change))
    return json.loads(response.body)


async def get_meta(jp_fetch):
    response = await jp_fetch(NAMESPACE, "meta")
    assert response.code == 200
    return json.loads(response.body)


def workspace_files(directory):
    return {path.name: path.read_bytes() for path in directory.glob("*.jupyterlab-workspace")}


async def test_records_in_own_file(jp_fetch, custom_workspaces_dir):
    """ACC-SERVER-84: all three fields in workspace-manager.json, no workspace file touched."""
    await put_workspace(jp_fetch, "fb-review")
    await put_workspace(jp_fetch, "other")
    before = workspace_files(custom_workspaces_dir)

    await patch(jp_fetch, "fb-review", RECORD)

    assert json.loads((custom_workspaces_dir / RECORDS_FILE).read_text()) == {"fb-review": RECORD}
    assert workspace_files(custom_workspaces_dir) == before
    assert len(before) == 2


async def test_read_records(jp_fetch):
    """ACC-SERVER-117: GET returns the record of every workspace that has one."""
    await put_workspace(jp_fetch, "one")
    await put_workspace(jp_fetch, "two")
    await patch(jp_fetch, "one", RECORD)
    await patch(jp_fetch, "two", {"colour": "sky"})

    assert await get_meta(jp_fetch) == {"one": RECORD, "two": {"colour": "sky"}}


async def test_patch_changes_one_record(jp_fetch):
    """ACC-SERVER-118: two PATCH calls for two workspaces at once keep both; unnamed fields stay."""
    await put_workspace(jp_fetch, "one")
    await put_workspace(jp_fetch, "two")
    await patch(jp_fetch, "one", {"purpose": "first"})

    await asyncio.gather(
        patch(jp_fetch, "one", {"colour": "rose"}),
        patch(jp_fetch, "two", {"colour": "peach", "hidden": False}),
    )

    assert await get_meta(jp_fetch) == {
        "one": {"purpose": "first", "colour": "rose"},
        "two": {"colour": "peach", "hidden": False},
    }


@pytest.mark.parametrize(
    "change",
    [{"colour": "magenta"}, {"purpose": "x" * 101}, {"hidden": "yes"}, {"hidden": 1}],
)
async def test_bad_values_refused(jp_fetch, change):
    """ACC-SERVER-119: a bad colour, purpose or hidden value answers 400; the record stays."""
    await put_workspace(jp_fetch, "one")
    await patch(jp_fetch, "one", RECORD)

    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await patch(jp_fetch, "one", change)

    assert refused.value.code == 400
    assert await get_meta(jp_fetch) == {"one": RECORD}


@pytest.mark.parametrize("change", [{"given": True}, {"colour": "sky", "given": "yes"}, {"colour": "sky", "given": 1}])
async def test_bad_given_refused(jp_fetch, change):
    """ACC-ACCORD-16: given is true or false, and true only with the colour it gives."""
    await put_workspace(jp_fetch, "one")

    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await patch(jp_fetch, "one", change)

    assert refused.value.code == 400
    assert await get_meta(jp_fetch) == {}


async def test_last_given_colour_stored(jp_fetch, custom_workspaces_dir):
    """ACC-ACCORD-16: a colour the rotation gives is stored as the last one; GET returns it to every window."""
    await put_workspace(jp_fetch, "one")
    await put_workspace(jp_fetch, "two")

    assert await patch(jp_fetch, "one", {"colour": "sky", "given": True}) == {"colour": "sky"}

    assert await get_meta(jp_fetch) == {"one": {"colour": "sky"}, LAST_COLOUR: "sky"}
    # a colour the user picks is not one the rotation gave
    await patch(jp_fetch, "two", {"colour": "rose"})
    assert (await get_meta(jp_fetch))[LAST_COLOUR] == "sky"
    # it outlives the workspace it was given to, so the rotation goes on after a delete
    await jp_fetch("lab", "api", "workspaces", "one", method="DELETE")
    assert await get_meta(jp_fetch) == {"two": {"colour": "rose"}, LAST_COLOUR: "sky"}
    assert json.loads((custom_workspaces_dir / RECORDS_FILE).read_text())[LAST_COLOUR] == "sky"


async def test_first_given_colour_stays(jp_fetch):
    """ACC-ACCORD-17: two windows give a new workspace a colour at once; the first stays, other fields apply."""
    await put_workspace(jp_fetch, "one")
    await patch(jp_fetch, "one", {"colour": "sky", "given": True})

    second = await patch(jp_fetch, "one", {"colour": "lavender", "given": True, "purpose": "kept"})

    assert second == {"colour": "sky", "purpose": "kept"}
    assert await get_meta(jp_fetch) == {"one": {"colour": "sky", "purpose": "kept"}, LAST_COLOUR: "sky"}
    # a colour the user picks replaces it
    assert await patch(jp_fetch, "one", {"colour": "mint"}) == {"colour": "mint", "purpose": "kept"}


async def test_purpose_of_100_characters_accepted(jp_fetch):
    """ACC-SERVER-119: the limit itself is allowed."""
    await put_workspace(jp_fetch, "one")

    assert await patch(jp_fetch, "one", {"purpose": "x" * 100}) == {"purpose": "x" * 100}


async def test_failed_rename_keeps_old_file(jp_fetch, custom_workspaces_dir, monkeypatch):
    """ACC-SERVER-120: written to a temporary file and renamed; a failed rename leaves the old file."""
    await put_workspace(jp_fetch, "one")
    await patch(jp_fetch, "one", RECORD)
    records = custom_workspaces_dir / RECORDS_FILE
    old = records.read_bytes()
    replace = os.replace

    def crash_on_rename(source, destination, *args, **kwargs):
        if str(destination) == str(records):
            raise OSError("crash during the rename")
        return replace(source, destination, *args, **kwargs)

    monkeypatch.setattr(os, "replace", crash_on_rename)

    with pytest.raises(tornado.httpclient.HTTPClientError) as failed:
        await patch(jp_fetch, "one", {"colour": "sky"})

    assert failed.value.code == 500
    assert records.read_bytes() == old


async def test_unreadable_file_moved_aside(jp_fetch, jp_serverapp, custom_workspaces_dir, caplog):
    """ACC-SERVER-121: invalid JSON goes to .bad, records start empty, the log names the move."""
    custom_workspaces_dir.mkdir()
    records = custom_workspaces_dir / RECORDS_FILE
    records.write_text("{not json")
    jp_serverapp.log.addHandler(caplog.handler)  # the server log does not propagate to the root

    try:
        assert await get_meta(jp_fetch) == {}
    finally:
        jp_serverapp.log.removeHandler(caplog.handler)

    assert (custom_workspaces_dir / (RECORDS_FILE + ".bad")).read_text() == "{not json"
    assert json.loads(records.read_text()) == {}
    assert any(
        record.levelno == logging.WARNING and f"moved to {records}.bad" in record.getMessage()
        for record in caplog.records
    )


async def test_records_in_lab_workspaces_dir(jp_fetch, custom_workspaces_dir):
    """ACC-SERVER-122: the records file sits in the custom LabApp.workspaces_dir."""
    await put_workspace(jp_fetch, "one")

    await patch(jp_fetch, "one", {"colour": "lemon"})

    assert json.loads((custom_workspaces_dir / RECORDS_FILE).read_text()) == {"one": {"colour": "lemon"}}


async def test_no_record_of_deleted_workspace(jp_fetch, custom_workspaces_dir):
    """ACC-CULLER-66: a workspace deleted outside the extension loses its record."""
    await put_workspace(jp_fetch, "gone")
    await put_workspace(jp_fetch, "kept")
    await patch(jp_fetch, "gone", RECORD)
    await patch(jp_fetch, "kept", {"colour": "sky"})

    await jp_fetch("lab", "api", "workspaces", "gone", method="DELETE")

    assert await get_meta(jp_fetch) == {"kept": {"colour": "sky"}}
    assert json.loads((custom_workspaces_dir / RECORDS_FILE).read_text()) == {"kept": {"colour": "sky"}}


async def test_workspace_mtime_unchanged(jp_fetch, custom_workspaces_dir):
    """ACC-CULLER-85: hide, purpose and colour leave the workspace file's mtime, the culler's clock."""
    await put_workspace(jp_fetch, "one")
    (workspace,) = custom_workspaces_dir.glob("*.jupyterlab-workspace")
    two_days_ago = workspace.stat().st_mtime - 2 * 24 * 3600
    os.utime(workspace, (two_days_ago, two_days_ago))
    mtime = workspace.stat().st_mtime_ns

    await patch(jp_fetch, "one", RECORD)
    await get_meta(jp_fetch)

    assert workspace.stat().st_mtime_ns == mtime


async def test_endpoints_end_nothing(jp_fetch, custom_workspaces_dir):
    """ACC-CULLER-67, server side: every endpoint leaves terminals and workspaces running and saved."""
    await put_workspace(jp_fetch, "one")
    await put_workspace(jp_fetch, "no-record")  # GET meta must not remove a workspace that has no record
    terminal = json.loads((await jp_fetch("api", "terminals", method="POST", body="{}")).body)["name"]
    before = workspace_files(custom_workspaces_dir)

    await jp_fetch(NAMESPACE, "terminals")
    await patch(jp_fetch, "one", RECORD)
    await get_meta(jp_fetch)
    await jp_fetch(NAMESPACE, "presence", method="POST", body=json.dumps({"window": "w", "workspace": "one"}))
    await jp_fetch(NAMESPACE, "presence", params={"window": "v"})

    terminals = json.loads((await jp_fetch("api", "terminals")).body)
    assert [t["name"] for t in terminals] == [terminal]
    assert workspace_files(custom_workspaces_dir) == before


async def test_record_before_first_save_kept(jp_fetch, custom_workspaces_dir, clock):
    """DEF-SERVER-9: a record given before JupyterLab first saves the workspace, with no folder yet, is kept."""
    assert not custom_workspaces_dir.exists()

    assert await patch(jp_fetch, "new", {"colour": "sky", "given": True}) == {"colour": "sky"}

    assert await get_meta(jp_fetch) == {"new": {"colour": "sky"}, LAST_COLOUR: "sky"}
    await put_workspace(jp_fetch, "new")
    clock[0] += 3600
    assert await get_meta(jp_fetch) == {"new": {"colour": "sky"}, LAST_COLOUR: "sky"}


async def test_record_of_never_saved_workspace_pruned(jp_fetch, clock):
    """DEF-SERVER-9: a workspace never saved loses its record 90 s after the record was written."""
    await patch(jp_fetch, "never", {"purpose": "kept a while"})

    clock[0] += 90
    assert await get_meta(jp_fetch) == {"never": {"purpose": "kept a while"}}

    clock[0] += 1
    assert await get_meta(jp_fetch) == {}


async def test_record_given_before_save_follows_the_file(jp_fetch):
    """DEF-SERVER-9: once the workspace is saved, a delete prunes the record given before the save."""
    await patch(jp_fetch, "early", RECORD)
    await put_workspace(jp_fetch, "early")
    assert await get_meta(jp_fetch) == {"early": RECORD}

    await jp_fetch("lab", "api", "workspaces", "early", method="DELETE")

    assert await get_meta(jp_fetch) == {}
