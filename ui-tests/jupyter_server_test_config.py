"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
import os
import shutil
from tempfile import mkdtemp

from jupyter_core.paths import jupyter_path
from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)

# A deleted path is removed, not sent to the platform trash. The server root is under /tmp
# on this machine's overlay filesystem, where send2trash targets /.Trash-1000, which the
# lab user cannot create: the DELETE of a test's scratch folder then answers 400.
# The workstation image sets it on AsyncLargeFileManager, the server's own class, in
# /opt/conda/etc/jupyter/jupyter_lab_config.py; that outranks a FileContentsManager line.
c.FileContentsManager.delete_to_trash = False
c.AsyncLargeFileManager.delete_to_trash = False

# Each test has a scratch folder tests-<name> in the server root, which Galata deletes when
# the test ends. The root listing reads every entry after listing the names, so a folder that
# another worker deletes in between makes the whole listing answer 404, and the window that
# loads then shows "Directory not found" and never gets its Launcher active. Hidden from the
# listing, the folders stay reachable by their path.
c.ContentsManager.hide_globs = ["__pycache__", "*.pyc", "*.pyo", ".DS_Store", "*~", "tests-*"]

# configure_jupyter_server moves the workspaces and the server root, not the user settings;
# without this a settings write to the test server lands in ~/.jupyter/lab/user-settings
c.LabApp.user_settings_dir = mkdtemp(prefix="galata-settings-")

# `or`, not a get() default: JavaScript's `||` reads "" as absent and falls back, so an
# exported-but-empty JUPYTER_TEST_PORT must fall back here too (playwright.config.js)
c.ServerApp.port = int(os.environ.get("JUPYTER_TEST_PORT") or "8888")

# The test lab loads Galata and the lab extensions below only, as on CI: this extension and
# the theme legibility.spec.ts reads the panel in. Every other lab extension installed on the
# machine adds work to each page load on the single-threaded server (its settings schemas, the
# theme file search, the requests its plugins send at start). With the 71 of the workstation
# image, 12 windows loading at once took 12 s of the 15 s that Galata's page.goto() waits for
# the app to start, and a test whose window loaded last failed there; with these only they
# take 4.5 s. A built copy in extra_labextensions_path loads as before; an installed copy is
# copied into the one folder that replaces the standard paths.
only = mkdtemp(prefix="galata-labextensions-")
for name in ["jupyterlab_workspace_manager_extension", "galaxalabs_jupyterlab_steel_dark_theme"]:
    for path in jupyter_path("labextensions"):
        if os.path.isdir(os.path.join(path, name)):
            shutil.copytree(os.path.join(path, name), os.path.join(only, name))
            break
c.LabApp.labextensions_path = [only]

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"
