import json
import os
from pathlib import Path
from time import time

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from jupyterlab_server.workspaces_handler import WORKSPACE_EXTENSION, slugify
import tornado

NAMESPACE = "jupyterlab-workspace-manager-extension"
RECORDS_FILE = "workspace-manager.json"
# Window id -> {workspace, reported}; on disk, so a restarted server knows the windows of the last 90 s
PRESENCE_FILE = "workspace-manager-presence.json"
# The colour the rotation gave last, beside the records; no workspace id holds a "/"
LAST_COLOUR = "/last-colour"
# Workspace id -> time a record was written while the workspace had no file yet
UNSAVED = "/unsaved"
COLOURS = ("rose", "peach", "lemon", "mint", "sky", "lavender")
PURPOSE_MAX = 100
# A window reports every 30 s; its report counts for 90 s, so one lost report is tolerated
PRESENCE_SECONDS = 90
# JupyterLab saves a new workspace about a second after its window loads; a record kept this long
# without a file belongs to a workspace that was never saved
UNSAVED_SECONDS = 90
RECORD_FIELDS = {
    "purpose": lambda value: isinstance(value, str) and len(value) <= PURPOSE_MAX,
    "colour": lambda value: value in COLOURS,
    "hidden": lambda value: isinstance(value, bool),
}


def process_name(pty):
    """Name of the foreground process of a terminal's pty; None when it cannot be read."""
    try:
        pgid = os.tcgetpgrp(pty.ptyproc.fd)
        return Path(f"/proc/{pgid}/comm").read_text().strip()
    except OSError:
        return None


class TerminalsHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        # absent when the server runs without terminals
        manager = self.settings.get("terminal_manager")
        models = manager.list() if manager else []
        for model in models:
            model["process"] = process_name(manager.terminals[model["name"]])
        self.finish(json.dumps(models))


def records_path(serverapp):
    """The records file in LabApp.workspaces_dir of the running lab, the directory the culler reads."""
    (lab,) = serverapp.extension_manager.extension_apps["jupyterlab"]
    return Path(lab.workspaces_dir) / RECORDS_FILE


def saved(path, workspace):
    """Whether the workspace has its file beside the records file at path."""
    return (path.parent / (slugify(workspace) + WORKSPACE_EXTENSION)).exists()


def save_records(path, records):
    """Write the whole file to a temporary file and rename it into place."""
    path.parent.mkdir(parents=True, exist_ok=True)  # JupyterLab creates the folder at its first save
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump(records, file, indent=2, sort_keys=True)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)


def load_records(path, log):
    """The records by workspace id; an unreadable file is moved to .bad and an empty one starts."""
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(records, dict) or not all(
            isinstance(r, dict) for w, r in records.items() if w != LAST_COLOUR
        ):
            raise ValueError("not an object of records")
    except FileNotFoundError:
        return {}
    except ValueError as error:
        bad = path.with_name(path.name + ".bad")
        os.replace(path, bad)
        log.warning(f"Unreadable workspace records file {path} ({error}) moved to {bad}; starting empty")
        save_records(path, {})
        return {}
    return records


class MetaHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        path = records_path(self.serverapp)
        records = load_records(path, self.log)
        marks = records.pop(UNSAVED, {})
        now = time()
        # abs: a clock set back must not keep a mark longer
        unsaved = {
            workspace: written
            for workspace, written in marks.items()
            if not saved(path, workspace) and abs(now - written) <= UNSAVED_SECONDS
        }
        kept = {
            workspace: record
            for workspace, record in records.items()
            if workspace == LAST_COLOUR or workspace in unsaved or saved(path, workspace)
        }
        # a workspace was deleted, by the panel or by the culler, or was saved, or was never saved
        if kept != records or unsaved != marks:
            save_records(path, {**kept, UNSAVED: unsaved} if unsaved else kept)
        self.finish(json.dumps(kept))


class MetaRecordHandler(APIHandler):
    @tornado.web.authenticated
    def patch(self, workspace):
        change = self.get_json_body()
        # given: the colour comes from the rotation, so it becomes the last colour given
        given = isinstance(change, dict) and change.pop("given", False)
        if (
            not isinstance(change, dict)
            or not all(field in RECORD_FIELDS and RECORD_FIELDS[field](value) for field, value in change.items())
            or not isinstance(given, bool)
            or (given and "colour" not in change)
            or workspace in (LAST_COLOUR, UNSAVED)
        ):
            raise tornado.web.HTTPError(
                400,
                f"fields: purpose (at most {PURPOSE_MAX} characters), colour ({', '.join(COLOURS)}),"
                " hidden (true or false), given (true with a colour)",
            )
        path = records_path(self.serverapp)
        records = load_records(path, self.log)
        record = records.setdefault(workspace, {})
        if given and "colour" in record:  # another window gave it a colour first; that colour stays
            del change["colour"]
        elif given:
            records[LAST_COLOUR] = change["colour"]
        record.update(change)
        if record.get("purpose") == "":  # an empty purpose is not stored
            del record["purpose"]
        if not saved(path, workspace):  # GET keeps the record until JupyterLab first saves the workspace
            records.setdefault(UNSAVED, {})[workspace] = time()
        save_records(path, records)
        self.finish(json.dumps(record))


def reports(serverapp, log):
    """The presence file's path and the reports of the last 90 s by window id."""
    path = records_path(serverapp).with_name(PRESENCE_FILE)
    now = time()
    # abs: a clock set back must not keep a closed window's report longer
    return path, {
        window: report
        for window, report in load_records(path, log).items()
        if abs(now - report["reported"]) <= PRESENCE_SECONDS
    }


class PresenceHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        """The workspaces that windows other than ?window= reported in the last 90 s."""
        window = self.get_query_argument("window", "")
        _, windows = reports(self.serverapp, self.log)
        workspaces = {report["workspace"] for other, report in windows.items() if other != window}
        self.finish(json.dumps({"workspaces": sorted(workspaces)}))

    @tornado.web.authenticated
    def post(self):
        """A window reports its workspace; the report replaces that window's previous one."""
        report = self.get_json_body()
        if not isinstance(report, dict) or not all(
            isinstance(report.get(key), str) and report[key] for key in ("window", "workspace")
        ):
            raise tornado.web.HTTPError(400, "body: {window, workspace} as non-empty strings")
        path, windows = reports(self.serverapp, self.log)
        windows[report["window"]] = {"workspace": report["workspace"], "reported": time()}
        save_records(path, windows)
        self.set_status(204)
        self.finish()


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    def route(*parts):
        return url_path_join(base_url, NAMESPACE, *parts)

    handlers = [
        (route("terminals"), TerminalsHandler),
        (route("meta"), MetaHandler),
        (route("meta", "([^/]+)"), MetaRecordHandler),
        (route("presence"), PresenceHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
