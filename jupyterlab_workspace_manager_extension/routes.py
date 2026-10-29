import json
import math
import os
import uuid
from contextlib import suppress
from pathlib import Path
from time import time

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from jupyterlab_server.workspaces_handler import WORKSPACE_EXTENSION, slugify
import psutil
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
# A claim blocks a plain report this long: long enough for a report already in flight, short enough
# that the window's move reaches the other windows' presence at once
CLAIM_HOLD_SECONDS = 5
# CLI switch requests for the panel windows, beside the records; a window reads one once, and one
# unread for 90 s belonged to a window that died (the panel polls every 1 s, a hidden tab once a minute)
SWITCH_FILE = "workspace-manager-switch.json"
SWITCH_SECONDS = 90
# JupyterLab saves a new workspace about a second after its window loads; a record kept this long
# without a file belongs to a workspace that was never saved
UNSAVED_SECONDS = 90
RECORD_FIELDS = {
    "purpose": lambda value: isinstance(value, str) and len(value) <= PURPOSE_MAX,
    "colour": lambda value: value in COLOURS,
    "hidden": lambda value: isinstance(value, bool),
    # json.loads takes NaN and Infinity, which no browser parses back
    "position": lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value),
}
# Kernel id -> {pid: psutil.Process} for the kernel and its children; cpu_percent() measures since
# the previous call on the same object
PROCESSES = {}


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
        live = []
        for model in models:
            pty = manager.terminals[model["name"]]
            # terminado keeps a shut-down terminal until its pty closes; a row of an ended pty leaves
            if pty.ptyproc.terminated or not pty.ptyproc.isalive():
                continue
            model["process"] = process_name(pty)
            live.append(model)
        self.finish(json.dumps(live))


def resources(kernel_id, kernel):
    """Resident memory in bytes of a kernel's process and its children, and their CPU percent of one core."""
    # a local kernel's Popen; a remote provisioner has none
    pid = getattr(getattr(kernel.provisioner, "process", None), "pid", None)
    try:
        if pid is None:  # psutil.Process(None) is this server
            raise psutil.NoSuchProcess(pid)
        known = PROCESSES.get(kernel_id, {})
        process = known.get(pid) or psutil.Process(pid)  # keyed by pid, so a restarted kernel gets a new object
        memory, cpu = process.memory_info().rss, process.cpu_percent()
        tree = {pid: process}
        for child in process.children(recursive=True):
            child = tree[child.pid] = known.get(child.pid, child)
            with suppress(psutil.Error):  # a child may end while it is read
                memory += child.memory_info().rss
                cpu += child.cpu_percent()
        PROCESSES[kernel_id] = tree
        return {"memory": memory, "cpu": cpu}
    except psutil.Error:
        PROCESSES.pop(kernel_id, None)
        return {"memory": None, "cpu": None}


class KernelsHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        """Per running kernel id, its memory in bytes and CPU percent; null for both when its process is unreadable."""
        manager = self.kernel_manager
        ids = set(manager.list_kernel_ids())
        for gone in PROCESSES.keys() - ids:
            del PROCESSES[gone]
        self.finish(json.dumps({kernel: resources(kernel, manager.get_kernel(kernel)) for kernel in ids}))


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
                " hidden (true or false), position (a finite number), given (true with a colour)",
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
        """The workspaces other windows reported in the last 90 s, and every live window with its workspace."""
        window = self.get_query_argument("window", "")
        _, windows = reports(self.serverapp, self.log)
        workspaces = {report["workspace"] for other, report in windows.items() if other != window}
        self.finish(
            json.dumps(
                {
                    "workspaces": sorted(workspaces),
                    "windows": [
                        {"window": other, "workspace": report["workspace"]}
                        for other, report in sorted(windows.items())
                    ],
                }
            )
        )

    @tornado.web.authenticated
    def post(self):
        """A window reports its workspace; the report replaces that window's previous one.

        A claim is also refused when another live window reports the same workspace,
        and a plain report cannot replace a claim until the claim's 5 s hold ends.
        """
        report = self.get_json_body()
        if (
            not isinstance(report, dict)
            or not all(
                isinstance(report.get(key), str) and report[key] for key in ("window", "workspace")
            )
            or not isinstance(report.get("claim", False), bool)
        ):
            raise tornado.web.HTTPError(
                400, "body: {window, workspace} as non-empty strings, claim as a boolean when given"
            )
        path, windows = reports(self.serverapp, self.log)
        claim = report.get("claim", False)
        if claim and any(
            other != report["window"] and other_report["workspace"] == report["workspace"]
            for other, other_report in windows.items()
        ):
            raise tornado.web.HTTPError(409, f"workspace {report['workspace']} is open in another window")
        now = time()
        record = windows.get(report["window"])
        if not claim and record and abs(now - record.get("claimed", 0)) <= CLAIM_HOLD_SECONDS:
            # a plain report crossing a claim keeps the claim's workspace; the window stays live
            record["reported"] = now
        else:
            windows[report["window"]] = {
                "workspace": report["workspace"],
                "reported": now,
                **({"claimed": now} if claim else {}),
            }
        save_records(path, windows)
        self.set_status(204)
        self.finish()


def switch_requests(serverapp, log):
    """The switch file's path, its live requests by request id, and whether expiry dropped any."""
    path = records_path(serverapp).with_name(SWITCH_FILE)
    stored = load_records(path, log)
    now = time()
    # abs: a clock set back must not keep an unread request longer
    live = {
        request_id: request
        for request_id, request in stored.items()
        if isinstance(request.get("created"), (int, float)) and abs(now - request["created"]) <= SWITCH_SECONDS
    }
    return path, live, live != stored


class SwitchHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        """The requests not yet delivered to ?window=, which this read marks delivered."""
        window = self.get_query_argument("window", "")
        if not window:
            raise tornado.web.HTTPError(400, "window: a non-empty window id")
        path, requests, expired = switch_requests(self.serverapp, self.log)
        mine = [
            request
            for request in requests.values()
            if request.get("window") in (None, window)
            and (not request.get("targets") or window in request["targets"])
            and window not in request.get("delivered", [])
            # the workspace file is the authority: a deleted workspace is not reopened, and the
            # request is skipped, not marked read, so a file that returns can still be reached
            and (not request.get("workspace") or saved(path, request["workspace"]))
        ]
        # the client applies the requests in read order, so the earliest command lands first
        mine.sort(key=lambda request: request.get("created", 0))
        for request in mine:
            request["delivered"] = request.get("delivered", []) + [window]
        if mine or expired:
            save_records(path, requests)
        self.finish(
            json.dumps(
                {"requests": [{"workspace": request.get("workspace"), "tab": request.get("tab")} for request in mine]}
            )
        )

    @tornado.web.authenticated
    def post(self):
        """Record a switch request for every window, or for the window the body names."""
        request = self.get_json_body()
        fields = ("workspace", "tab", "window")
        if (
            not isinstance(request, dict)
            or not any(isinstance(request.get(key), str) and request[key] for key in ("workspace", "tab"))
            or not all(isinstance(request[key], str) and request[key] for key in fields if key in request)
        ):
            raise tornado.web.HTTPError(400, "body: workspace or tab, and a window when given, as non-empty strings")
        if "workspace" in request and not saved(records_path(self.serverapp), request["workspace"]):
            raise tornado.web.HTTPError(404, f"unknown workspace {request['workspace']}")
        live = reports(self.serverapp, self.log)[1]
        if "window" in request and request["window"] not in live:
            raise tornado.web.HTTPError(404, f"unknown window {request['window']}")
        path, requests, _ = switch_requests(self.serverapp, self.log)
        requests[uuid.uuid4().hex] = {
            **{key: request[key] for key in fields if key in request},
            # a broadcast reaches the windows live now; one opened later must not replay it
            "targets": [request["window"]] if "window" in request else list(live),
            "created": time(),
            "delivered": [],
        }
        save_records(path, requests)
        self.set_status(204)
        self.finish()


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    def route(*parts):
        return url_path_join(base_url, NAMESPACE, *parts)

    handlers = [
        (route("terminals"), TerminalsHandler),
        (route("kernels"), KernelsHandler),
        (route("meta"), MetaHandler),
        (route("meta", "([^/]+)"), MetaRecordHandler),
        (route("presence"), PresenceHandler),
        (route("switch"), SwitchHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
