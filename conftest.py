import pytest

from jupyterlab_workspace_manager_extension import routes

pytest_plugins = ("pytest_jupyter.jupyter_server", )


@pytest.fixture
def custom_workspaces_dir(tmp_path):
    return tmp_path / "custom-workspaces"


@pytest.fixture
def jp_server_config(jp_server_config, custom_workspaces_dir):
    return {
        "ServerApp": {
            # the lab's workspaces_dir holds the records and the presence file
            "jpserver_extensions": {"jupyterlab": True, "jupyterlab_workspace_manager_extension": True},
            # Test against a server which requires authentication on all endpoints
            "allow_unauthenticated_access": False,
        },
        "LabApp": {"workspaces_dir": str(custom_workspaces_dir)},
    }


@pytest.fixture
def clock(monkeypatch):
    """A fake wall clock the routes read; advance it with clock[0] += seconds."""
    now = [1000.0]
    monkeypatch.setattr(routes, "time", lambda: now[0])
    return now
