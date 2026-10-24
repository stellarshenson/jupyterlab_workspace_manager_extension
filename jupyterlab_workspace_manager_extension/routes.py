import json
import os
from pathlib import Path
from time import monotonic

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from jupyterlab_server.workspaces_handler import WORKSPACE_EXTENSION, slugify
import tornado

NAMESPACE = "jupyterlab-workspace-manager-extension"
RECORDS_FILE = "workspace-manager.json"
# The colour the rotation gave last, beside the records; no workspace id holds a "/"
LAST_COLOUR = "/last-colour"
COLOURS = ("rose", "peach", "lemon", "mint", "sky", "lavender")
PURPOSE_MAX = 100
# A window reports every 30 s; its report counts for 90 s, so one lost report is tolerated
PRESENCE_SECONDS = 90
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


def save_records(path, records):
    """Write the whole file to a temporary file and rename it into place."""
    temporary = path.with_name(RECORDS_FILE + ".tmp")
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
        bad = path.with_name(RECORDS_FILE + ".bad")
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
        kept = {
            workspace: record
            for workspace, record in records.items()
            if workspace == LAST_COLOUR or (path.parent / (slugify(workspace) + WORKSPACE_EXTENSION)).exists()
        }
        if kept != records:  # a workspace was deleted, by the panel or by the culler
            save_records(path, kept)
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
            or workspace == LAST_COLOUR
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
        save_records(path, records)
        self.finish(json.dumps(record))


class PresenceHandler(APIHandler):
    def initialize(self, windows):
        self.windows = windows  # window id -> (workspace, report time)

    @tornado.web.authenticated
    def get(self):
        """The workspaces that windows other than ?window= reported in the last 90 s."""
        window = self.get_query_argument("window", "")
        now = monotonic()
        workspaces = {
            workspace
            for other, (workspace, reported) in self.windows.items()
            if other != window and now - reported <= PRESENCE_SECONDS
        }
        self.finish(json.dumps({"workspaces": sorted(workspaces)}))

    @tornado.web.authenticated
    def post(self):
        """A window reports its workspace; the report replaces that window's previous one."""
        report = self.get_json_body()
        if not isinstance(report, dict) or not all(
            isinstance(report.get(key), str) and report[key] for key in ("window", "workspace")
        ):
            raise tornado.web.HTTPError(400, "body: {window, workspace} as non-empty strings")
        now = monotonic()
        for stale in [w for w, (_, reported) in self.windows.items() if now - reported > PRESENCE_SECONDS]:
            del self.windows[stale]
        self.windows[report["window"]] = (report["workspace"], now)
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
        (route("presence"), PresenceHandler, {"windows": {}}),
    ]

    web_app.add_handlers(host_pattern, handlers)
