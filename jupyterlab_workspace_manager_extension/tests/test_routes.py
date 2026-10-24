import pytest


@pytest.fixture
def jp_server_config(jp_server_config):
    # A server that lets undecorated handlers through, so each 403 below comes from the route's own decorator
    return {**jp_server_config, "ServerApp": {**jp_server_config["ServerApp"], "allow_unauthenticated_access": True}}


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("GET", "terminals", None),
        ("GET", "meta", None),
        ("PATCH", "meta/one", '{"hidden": true}'),
        ("GET", "presence?window=w", None),
        ("POST", "presence", '{"window": "w", "workspace": "one"}'),
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
