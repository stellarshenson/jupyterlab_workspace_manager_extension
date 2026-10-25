"""The jupyterlab-workspace CLI: lab selection, every command, every refusal and the shipped skill."""
import argparse
import datetime
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
from pathlib import Path

import pytest

from jupyterlab_workspace_manager_extension import cli

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / '.agents' / 'skills' / 'jupyterlab-workspace-manager-extension' / 'SKILL.md'
NAMESPACE = 'jupyterlab-workspace-manager-extension'
SERVER = {'port': 8888, 'base_url': '/', 'root_dir': '/srv/lab', 'token': 'record-token'}


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    """No discovery variable leaks in from the workstation's own lab."""
    for name in (
        'JUPYTERHUB_API_TOKEN',
        'JPY_API_TOKEN',
        'JUPYTER_TOKEN',
        'JUPYTER_PORT',
        'JUPYTER_SERVER_URL',
        'JUPYTER_SERVER_ROOT',
        'JUPYTERHUB_SERVICE_PREFIX',
        'JUPYTERHUB_SERVICE_URL',
    ):
        monkeypatch.delenv(name, raising=False)


def stamp(minutes_ago=1):
    return (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes_ago)).isoformat()


def workspace(name, minutes_ago=1, keys=()):
    """A workspace as `GET /lab/api/workspaces` lists it, with the saved data its keys point at."""
    data = {'layout-restorer:data': {'main': {'dock': {'type': 'tab-area', 'widgets': list(keys)}}}}
    for key in keys:
        kind, rest = key.split(':', 1)
        data[key] = {'data': {'name': rest} if kind == 'terminal' else {'path': rest}}
    return {'data': data, 'metadata': {'id': '/' + name, 'last_modified': stamp(minutes_ago)}}


def split_workspace(name, minutes_ago=1):
    """A workspace whose main area is split: two tab areas side by side."""
    dock = {
        'type': 'split-area',
        'children': [
            {'type': 'tab-area', 'widgets': ['notebook:a.ipynb', 'terminal:1']},
            {'type': 'tab-area', 'widgets': ['editor:b.md']},
        ],
    }
    return {
        'data': {'layout-restorer:data': {'main': {'dock': dock}}},
        'metadata': {'id': '/' + name, 'last_modified': stamp(minutes_ago)},
    }


def session(path, kernel='k1', kind='notebook'):
    return {'id': 's-' + path, 'path': path, 'type': kind, 'kernel': {'id': kernel, 'name': 'python3'}}


class FakeLab:
    """The HTTP layer of a running lab, held in memory; every call is recorded."""

    def __init__(self, workspaces=(), records=None, presence=(), terminals=(), kernels=(), sessions=()):
        self.workspaces = json.loads(json.dumps(list(workspaces)))
        self.records = json.loads(json.dumps(records or {}))
        self.presence = list(presence)
        self.terminals = json.loads(json.dumps(list(terminals)))
        self.kernels = json.loads(json.dumps(list(kernels)))
        self.sessions = json.loads(json.dumps(list(sessions)))
        self.calls = []

    def request(self, base_url, token, method, path, payload=None):
        self.calls.append(
            {'base': base_url, 'token': token, 'method': method, 'path': path, 'payload': payload}
        )
        tail = path.rsplit('/', 1)[-1]
        if path == '/lab/api/workspaces' and method == 'GET':
            values = json.loads(json.dumps(self.workspaces))
            return {'workspaces': {'ids': [item['metadata']['id'] for item in values], 'values': values}}
        if path.startswith('/lab/api/workspaces/') and method == 'PUT':
            self.workspaces.append(payload)
            return None
        if path.startswith('/lab/api/workspaces/') and method == 'DELETE':
            name = urllib.parse.unquote(tail)
            mine = [item for item in self.workspaces if cli._name(item['metadata']['id']) == name]
            if not mine:
                raise cli.CLIError(f'DELETE {path} failed: 404 Not Found')
            self.workspaces.remove(mine[0])
            return None
        if path == '/jupyterlab-workspace-manager-extension/meta' and method == 'GET':
            return json.loads(json.dumps(self.records))
        if path.startswith('/jupyterlab-workspace-manager-extension/meta/') and method == 'PATCH':
            name = urllib.parse.unquote(tail)
            self.records[name] = {**self.records.get(name, {}), **payload}
            return self.records[name]
        if path.startswith('/jupyterlab-workspace-manager-extension/presence') and method == 'GET':
            return {'workspaces': list(self.presence)}
        if path == '/jupyterlab-workspace-manager-extension/terminals' and method == 'GET':
            return [
                {'name': item['name'], 'process': item.get('process'), 'last_activity': item.get('last_activity', '')}
                for item in self.terminals
            ]
        if path == '/api/terminals' and method == 'GET':
            return [{'name': item['name']} for item in self.terminals]
        if path.startswith('/api/terminals/') and method == 'DELETE':
            name = urllib.parse.unquote(tail)
            self.terminals = [item for item in self.terminals if item['name'] != name]
            return None
        if path == '/api/kernels' and method == 'GET':
            return json.loads(json.dumps(self.kernels))
        if path.startswith('/api/kernels/') and method == 'DELETE':
            kernel_id = urllib.parse.unquote(tail)
            self.kernels = [item for item in self.kernels if item['id'] != kernel_id]
            return None
        if path == '/api/sessions' and method == 'GET':
            return json.loads(json.dumps(self.sessions))
        raise AssertionError(f'unexpected request: {method} {path}')

    def methods(self, method):
        return [call for call in self.calls if call['method'] == method]


@pytest.fixture
def lab(monkeypatch):
    fake = FakeLab(workspaces=[workspace('alpha'), workspace('beta')])
    monkeypatch.setattr(cli, '_request', fake.request)
    monkeypatch.setattr(cli, '_server_list', lambda: [dict(SERVER)])
    monkeypatch.setenv('JUPYTER_PORT', '8888')
    return fake


def run(*argv):
    return cli.main(list(argv))


def out(capsys):
    captured = capsys.readouterr()
    return captured.out, captured.err


# --- ACC-CLI-170-LAB-FIND: selection and refusal of the lab -----------------


def test_server_url_selects_on_port_base_path_and_root(monkeypatch):
    """ACC-CLI-170: JUPYTER_SERVER_URL and JUPYTER_SERVER_ROOT pick the matching record, not the first."""
    monkeypatch.setenv('JUPYTER_SERVER_URL', 'http://127.0.0.1:8888/')
    monkeypatch.setenv('JUPYTER_SERVER_ROOT', '/srv/lab')
    records = [
        {'port': 9, 'base_url': '/', 'token': 'decoy'},
        {'port': 8888, 'base_url': '/', 'root_dir': '/tmp/galata-test-1', 'token': 'test'},
        {'port': 8888, 'base_url': '/', 'root_dir': '/srv/lab', 'token': 'lab'},
    ]
    assert cli._pick_server(records)['token'] == 'lab'


def test_server_url_root_mismatch_refuses(monkeypatch):
    """ACC-CLI-170: the same port bound by a test server is not the lab; refuse and list it."""
    monkeypatch.setenv('JUPYTER_SERVER_URL', 'http://127.0.0.1:8888/')
    monkeypatch.setenv('JUPYTER_SERVER_ROOT', '/srv/lab')
    records = [{'port': 8888, 'base_url': '/', 'root_dir': '/tmp/galata-test-1'}]
    with pytest.raises(cli.CLIError) as refused:
        cli._pick_server(records)
    assert 'JUPYTER_SERVER_URL' in str(refused.value)
    assert '8888' in str(refused.value)


def test_prefix_selects_by_base_path(monkeypatch):
    """ACC-CLI-170: JUPYTERHUB_SERVICE_PREFIX matches the base path."""
    monkeypatch.setenv('JUPYTERHUB_SERVICE_PREFIX', '/user/alice/')
    records = [
        {'port': 8888, 'base_url': '/', 'token': 'other'},
        {'port': 8889, 'base_url': '/user/alice/', 'token': 'alice'},
    ]
    assert cli._pick_server(records)['token'] == 'alice'


def test_port_selects_by_port(monkeypatch):
    """ACC-CLI-170: JUPYTER_PORT matches the port."""
    monkeypatch.setenv('JUPYTER_PORT', '8890')
    records = [{'port': 8888, 'token': 'a'}, {'port': 8890, 'token': 'b'}]
    assert cli._pick_server(records)['token'] == 'b'


def test_prefix_matching_nothing_refuses(monkeypatch):
    """ACC-CLI-170: a named variable always decides; no match is a refusal, not a fallback."""
    monkeypatch.setenv('JUPYTERHUB_SERVICE_PREFIX', '/user/nobody/')
    with pytest.raises(cli.CLIError) as refused:
        cli._pick_server([{'port': 8888, 'base_url': '/', 'token': 'a'}])
    assert 'JUPYTERHUB_SERVICE_PREFIX' in str(refused.value)


def test_one_token_record_is_the_lab():
    """ACC-CLI-170: no variable set, the one record carrying a token wins, even behind a decoy."""
    records = [{'port': 9}, {'port': 8888, 'token': 'lab'}]
    assert cli._pick_server(records)['token'] == 'lab'


def test_two_token_records_refuse(monkeypatch):
    """ACC-CLI-170: two candidate labs cannot be told apart; refuse and list them."""
    with pytest.raises(cli.CLIError) as refused:
        cli._pick_server([{'port': 8888, 'token': 'a'}, {'port': 8889, 'token': 'b'}])
    assert '8888' in str(refused.value) and '8889' in str(refused.value)


def test_no_record_uses_the_environment(monkeypatch):
    """ACC-CLI-170: with no record, JUPYTER_PORT builds the address; JUPYTER_TOKEN authenticates."""
    monkeypatch.setattr(cli, '_server_list', lambda: [])
    monkeypatch.setenv('JUPYTER_PORT', '8899')
    monkeypatch.setenv('JUPYTER_TOKEN', 'plain')
    assert cli._lab() == ('http://127.0.0.1:8899', 'plain')


def test_no_record_and_no_variable_refuses():
    """ACC-CLI-170: nothing names a lab, so there is nothing to guess."""
    with pytest.raises(cli.CLIError):
        cli._base_url({})


def test_token_order(monkeypatch):
    """ACC-CLI-170: hub token, then JPY token, then the record's token, then JUPYTER_TOKEN."""
    monkeypatch.setenv('JUPYTERHUB_API_TOKEN', 'hub')
    monkeypatch.setenv('JPY_API_TOKEN', 'jpy')
    monkeypatch.setenv('JUPYTER_TOKEN', 'plain')
    assert cli._token({'token': 'record'}) == 'hub'
    monkeypatch.delenv('JUPYTERHUB_API_TOKEN')
    assert cli._token({'token': 'record'}) == 'jpy'
    monkeypatch.delenv('JPY_API_TOKEN')
    assert cli._token({'token': 'record'}) == 'record'
    assert cli._token({}) == 'plain'


def test_a_mismatched_lab_exits_one_and_calls_nothing(lab, monkeypatch, capsys):
    """ACC-CLI-170: a refusal names the variable and sends no request."""
    monkeypatch.setenv('JUPYTERHUB_SERVICE_PREFIX', '/user/nobody/')
    assert run('workspaces', 'list') == 1
    stdout, stderr = out(capsys)
    assert stdout == ''
    assert 'JUPYTERHUB_SERVICE_PREFIX' in stderr
    assert lab.calls == []


def test_the_call_uses_the_selected_loopback_lab(monkeypatch, capsys):
    """ACC-CLI-170: the request reaches the selected record's address and carries its token."""
    fake = FakeLab(workspaces=[workspace('alpha')])
    monkeypatch.setattr(cli, '_request', fake.request)
    monkeypatch.setattr(cli, '_server_list', lambda: [{'port': 8888, 'base_url': '/user/alice/', 'token': 'lab'}])
    monkeypatch.setenv('JUPYTERHUB_SERVICE_PREFIX', '/user/alice/')
    assert run('workspaces', 'list', '--json') == 0
    assert fake.calls[0]['base'] == 'http://127.0.0.1:8888/user/alice'
    assert fake.calls[0]['token'] == 'lab'


# --- the HTTP layer: the token travels in the header only -------------------


class Reply:
    def __init__(self, body=b'[]'):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Opener:
    def __init__(self, reply=None, error=None):
        self.request = None
        self.reply = reply if reply is not None else Reply()
        self.error = error

    def open(self, request, timeout=None):
        self.request = request
        if self.error is not None:
            raise self.error
        return self.reply


def test_the_token_is_sent_in_the_authorization_header_only(monkeypatch):
    """ACC-CLI-170: the token never appears in the URL."""
    opener = Opener(Reply(b'[]'))
    monkeypatch.setattr(cli, '_OPENER', opener)
    assert cli._request('http://127.0.0.1:8888', 'sentinel-token', 'GET', '/api/kernels') == []
    assert opener.request.get_header('Authorization') == 'token sentinel-token'
    assert 'sentinel-token' not in opener.request.full_url


def test_a_failed_request_does_not_print_the_token(monkeypatch):
    """ACC-CLI-170: the failure message carries the path and the reason, never the token."""
    monkeypatch.setattr(cli, '_OPENER', Opener(error=urllib.error.URLError('refused')))
    with pytest.raises(cli.CLIError) as failed:
        cli._request('http://127.0.0.1:8888', 'sentinel-token', 'GET', '/api/kernels')
    assert 'sentinel-token' not in str(failed.value)
    assert '/api/kernels' in str(failed.value)


# --- ACC-CLI-171-LIST-OUT: workspaces list ---------------------------------


def listed_lab():
    return FakeLab(
        workspaces=[
            workspace('alpha', keys=['notebook:nb.ipynb', 'terminal:7', 'editor:notes.md']),
            workspace('beta'),
            workspace('gamma', keys=['terminal:1']),
        ],
        records={
            'alpha': {'purpose': 'Review the feedback', 'colour': 'mint'},
            'beta': {'purpose': 'Old work', 'colour': 'sky', 'hidden': True},
        },
        sessions=[session('nb.ipynb')],
    )


def test_workspaces_list_prints_every_fact(lab, capsys):
    """ACC-CLI-171: one line per workspace with name, purpose, colour, hidden, tabs, terminals, kernels."""
    lab.__dict__.update(listed_lab().__dict__)
    assert run('workspaces', 'list') == 0
    stdout, _ = out(capsys)
    assert stdout.splitlines() == [
        'NAME\tPURPOSE\tCOLOUR\tHIDDEN\tTABS\tTERMINALS\tKERNELS',
        'alpha\tReview the feedback\tmint\tno\t2\t1\t1',
        'beta\tOld work\tsky\tyes\t0\t0\t0',
        'gamma\t\t-\tno\t0\t1\t0',
    ]


def test_workspaces_list_json_carries_the_same_facts(lab, capsys):
    """ACC-CLI-171: --json prints the same facts as data."""
    lab.__dict__.update(listed_lab().__dict__)
    assert run('workspaces', 'list', '--json') == 0
    stdout, _ = out(capsys)
    assert json.loads(stdout) == [
        {
            'name': 'alpha',
            'purpose': 'Review the feedback',
            'colour': 'mint',
            'hidden': False,
            'tabs': 2,
            'terminals': 1,
            'kernels': 1,
        },
        {'name': 'beta', 'purpose': 'Old work', 'colour': 'sky', 'hidden': True, 'tabs': 0, 'terminals': 0, 'kernels': 0},
        {'name': 'gamma', 'purpose': '', 'colour': '', 'hidden': False, 'tabs': 0, 'terminals': 1, 'kernels': 0},
    ]


def test_the_list_table_prints_a_cell_on_one_line(lab, capsys):
    """ACC-CLI-171: a newline or a tab in a purpose becomes a space, so the row stays one line of seven fields."""
    lab.workspaces = [workspace('one')]
    lab.records = {'one': {'purpose': 'first\nsecond\tthird'}}
    assert run('workspaces', 'list') == 0
    lines = out(capsys)[0].splitlines()
    assert len(lines) == 2
    fields = lines[1].split('\t')
    assert len(fields) == 7
    assert fields[1] == 'first second third'


def test_list_counts_a_split_main_area_and_clean_keeps_it(lab, capsys):
    """ACC-CLI-171 / ACC-CLI-176: a split main area counts its terminals and kernels, so clean --empty keeps it."""
    lab.workspaces = [split_workspace('split-one')]
    lab.sessions = [session('a.ipynb')]
    assert run('workspaces', 'list', '--json') == 0
    row = json.loads(out(capsys)[0])[0]
    assert (row['terminals'], row['kernels']) == (1, 1)
    assert run('workspaces', 'clean', '--empty', '--yes') == 0
    assert 'no workspace matches' in out(capsys)[0]
    assert lab.methods('DELETE') == []


# --- ACC-CLI-172-ADD-WRITE: workspaces add ---------------------------------


def test_add_writes_the_workspace_and_its_record(lab, capsys):
    """ACC-CLI-172: add PUTs the workspace and PATCHes the record with purpose and colour."""
    assert run('workspaces', 'add', 'new-one', '--purpose', 'Review', '--colour', 'mint') == 0
    put = lab.methods('PUT')
    assert len(put) == 1
    assert put[0]['path'] == '/lab/api/workspaces/new-one'
    assert put[0]['payload'] == {'data': {}, 'metadata': {'id': 'new-one'}}
    patch = lab.methods('PATCH')
    assert len(patch) == 1
    assert patch[0]['path'] == '/jupyterlab-workspace-manager-extension/meta/new-one'
    assert patch[0]['payload'] == {'purpose': 'Review', 'colour': 'mint'}
    assert lab.records['new-one'] == {'purpose': 'Review', 'colour': 'mint'}
    assert 'new-one' in out(capsys)[0]


def test_add_an_existing_name_is_refused_and_writes_nothing(lab, capsys):
    """ACC-CLI-172: a second add of the same name fails with the name in the message."""
    assert run('workspaces', 'add', 'one') == 0
    writes = len(lab.methods('PUT')) + len(lab.methods('PATCH'))
    assert run('workspaces', 'add', 'one') == 1
    stdout, stderr = out(capsys)
    assert 'one' in stderr
    assert len(lab.methods('PUT')) + len(lab.methods('PATCH')) == writes


# --- ACC-CLI-173-OPEN-URL: workspaces open ---------------------------------


def test_open_prints_one_url_and_nothing_else(lab, capsys):
    """ACC-CLI-173: open prints the lab URL carrying the workspace name and base path."""
    assert run('workspaces', 'open', 'fb-review') == 0
    stdout, stderr = out(capsys)
    assert stdout == 'http://127.0.0.1:8888/lab/workspaces/fb-review\n'
    assert stderr == ''
    assert lab.calls == []


def test_open_carries_a_hub_base_path(monkeypatch, capsys):
    """ACC-CLI-173: the URL keeps the JupyterHub prefix of the selected lab."""
    monkeypatch.setattr(cli, '_server_list', lambda: [{'port': 8888, 'base_url': '/user/alice/', 'token': 't'}])
    monkeypatch.setenv('JUPYTERHUB_SERVICE_PREFIX', '/user/alice/')
    assert run('workspaces', 'open', 'fb-review') == 0
    assert out(capsys)[0] == 'http://127.0.0.1:8888/user/alice/lab/workspaces/fb-review\n'


# --- ACC-CLI-174-DESC-EDIT: workspaces describe ----------------------------


def test_describe_sets_every_field_and_prints_the_record(lab, capsys):
    """ACC-CLI-174: purpose, colour, hide and show each change the record and print it."""
    lab.workspaces = [workspace('one')]
    lab.records = {'one': {'purpose': 'old'}}

    assert run('workspaces', 'describe', 'one', '--purpose', 'new') == 0
    assert json.loads(out(capsys)[0]) == {'purpose': 'new'}

    assert run('workspaces', 'describe', 'one', '--colour', 'mint') == 0
    assert json.loads(out(capsys)[0]) == {'purpose': 'new', 'colour': 'mint'}

    assert run('workspaces', 'describe', 'one', '--hide') == 0
    assert json.loads(out(capsys)[0]) == {'purpose': 'new', 'colour': 'mint', 'hidden': True}

    assert run('workspaces', 'describe', 'one', '--show') == 0
    assert json.loads(out(capsys)[0]) == {'purpose': 'new', 'colour': 'mint', 'hidden': False}

    assert run('workspaces', 'list', '--json') == 0
    row = json.loads(out(capsys)[0])[0]
    assert (row['purpose'], row['colour'], row['hidden']) == ('new', 'mint', False)


def test_describe_with_no_field_prints_the_record(lab, capsys):
    """ACC-CLI-174: describe alone prints the record as it is and writes nothing."""
    lab.workspaces = [workspace('one')]
    lab.records = {'one': {'purpose': 'kept'}}
    assert run('workspaces', 'describe', 'one') == 0
    assert json.loads(out(capsys)[0]) == {'purpose': 'kept'}
    assert lab.methods('PATCH') == []


def test_describe_a_name_that_is_not_a_workspace_refuses(lab, capsys):
    """ACC-CLI-174: a typo is refused and no PATCH is sent, so no phantom record is written."""
    lab.workspaces = [workspace('one')]
    assert run('workspaces', 'describe', 'typo', '--colour', 'mint') == 1
    assert 'typo' in out(capsys)[1]
    assert lab.methods('PATCH') == []


# --- ACC-CLI-175-REMOVE-YES: workspaces remove -----------------------------


def test_remove_without_yes_refuses_and_writes_nothing(lab, capsys):
    """ACC-CLI-175: remove without --yes names the workspace and deletes nothing."""
    lab.workspaces = [workspace('one')]
    assert run('workspaces', 'remove', 'one') == 1
    assert 'one' in out(capsys)[1]
    assert lab.methods('DELETE') == []


def test_remove_with_yes_deletes(lab, capsys):
    """ACC-CLI-175: remove --yes calls DELETE and prints the name."""
    lab.workspaces = [workspace('one')]
    assert run('workspaces', 'remove', 'one', '--yes') == 0
    assert [call['path'] for call in lab.methods('DELETE')] == ['/lab/api/workspaces/one']
    assert 'one' in out(capsys)[0]


def test_remove_refuses_while_another_window_shows_the_workspace(lab, capsys):
    """ACC-CLI-175: a presence record for another window blocks the delete; the message names the workspace."""
    lab.workspaces = [workspace('one')]
    lab.presence = ['one']
    assert run('workspaces', 'remove', 'one', '--yes') == 1
    stderr = out(capsys)[1]
    assert 'workspace one' in stderr
    assert 'another browser window' in stderr
    assert lab.methods('DELETE') == []


# --- ACC-CLI-176-CLEAN-DRY: workspaces clean -------------------------------


def clean_lab():
    return FakeLab(
        workspaces=[
            workspace('hidden-one', keys=['terminal:1']),
            workspace('empty-one'),
            workspace('old-one', minutes_ago=60 * 24 * 10, keys=['editor:a.md']),
        ],
        records={'hidden-one': {'hidden': True}},
    )


@pytest.mark.parametrize(
    'selector,selected',
    [('--hidden', 'hidden-one'), ('--empty', 'empty-one'), ('--older-than', 'old-one')],
)
def test_clean_lists_exactly_what_it_would_delete(lab, capsys, selector, selected):
    """ACC-CLI-176: each selector names exactly its matches, and without --yes deletes nothing."""
    lab.__dict__.update(clean_lab().__dict__)
    arguments = ['workspaces', 'clean', selector]
    if selector == '--older-than':
        arguments.append('7')
    assert run(*arguments) == 1
    stdout = out(capsys)[0]
    assert f'would remove workspace {selected}' in stdout
    for other in {'hidden-one', 'empty-one', 'old-one'} - {selected}:
        assert other not in stdout
    assert lab.methods('DELETE') == []


@pytest.mark.parametrize(
    'selector,selected',
    [('--hidden', 'hidden-one'), ('--empty', 'empty-one'), ('--older-than', 'old-one')],
)
def test_clean_with_yes_deletes_exactly_the_selection(lab, capsys, selector, selected):
    """ACC-CLI-176: --yes deletes the workspaces the selector names and no others."""
    lab.__dict__.update(clean_lab().__dict__)
    arguments = ['workspaces', 'clean', selector, '--yes']
    if selector == '--older-than':
        arguments.insert(3, '7')
    assert run(*arguments) == 0
    deleted = [call['path'] for call in lab.methods('DELETE')]
    assert deleted == [f'/lab/api/workspaces/{selected}']
    assert [item['metadata']['id'] for item in lab.workspaces] != []
    assert selected not in [cli._name(item['metadata']['id']) for item in lab.workspaces]


def test_clean_selectors_combine(lab, capsys):
    """ACC-CLI-176: two selectors delete the union, listed once each."""
    lab.__dict__.update(clean_lab().__dict__)
    assert run('workspaces', 'clean', '--hidden', '--empty') == 1
    stdout = out(capsys)[0]
    assert 'would remove workspace hidden-one' in stdout
    assert 'would remove workspace empty-one' in stdout
    assert 'old-one' not in stdout
    assert run('workspaces', 'clean', '--hidden', '--empty', '--yes') == 0
    assert sorted(call['path'] for call in lab.methods('DELETE')) == [
        '/lab/api/workspaces/empty-one',
        '/lab/api/workspaces/hidden-one',
    ]


def test_clean_skips_a_workspace_another_window_shows(lab, capsys):
    """ACC-CLI-176: a selected workspace a presence record shows open is skipped, and the rest deleted."""
    lab.__dict__.update(clean_lab().__dict__)
    lab.presence = ['empty-one']
    assert run('workspaces', 'clean', '--hidden', '--empty', '--yes') == 0
    stdout = out(capsys)[0]
    assert 'skipped workspace empty-one: open in another browser window' in stdout
    assert 'removed workspace empty-one' not in stdout
    assert [call['path'] for call in lab.methods('DELETE')] == [
        '/lab/api/workspaces/hidden-one'
    ]


def test_clean_without_a_selector_is_a_usage_error(lab):
    """ACC-CLI-176: clean names what it deletes, so a selector is required; usage exits 2."""
    with pytest.raises(SystemExit) as usage:
        run('workspaces', 'clean')
    assert usage.value.code == 2


# --- ACC-CLI-177-TERM-KILL: terminals --------------------------------------


def terminal_lab():
    return FakeLab(
        terminals=[
            {'name': '1', 'process': 'fish', 'last_activity': '2026-10-25T01:00:00'},
            {'name': '2', 'process': None, 'last_activity': '2026-10-25T02:00:00'},
        ]
    )


def test_terminals_list_prints_name_and_process(lab, capsys):
    """ACC-CLI-177: list carries the process running in each terminal, in the table and in JSON."""
    lab.__dict__.update(terminal_lab().__dict__)
    assert run('terminals', 'list') == 0
    stdout = out(capsys)[0]
    assert stdout.splitlines() == [
        'NAME\tPROCESS\tLAST ACTIVITY',
        '1\tfish\t2026-10-25T01:00:00',
        '2\t\t2026-10-25T02:00:00',
    ]
    assert run('terminals', 'list', '--json') == 0
    assert json.loads(out(capsys)[0]) == [
        {'name': '1', 'process': 'fish', 'last_activity': '2026-10-25T01:00:00'},
        {'name': '2', 'process': '', 'last_activity': '2026-10-25T02:00:00'},
    ]


def test_terminals_kill_one(lab, capsys):
    """ACC-CLI-177: kill NAME calls the terminals route for that name."""
    lab.__dict__.update(terminal_lab().__dict__)
    assert run('terminals', 'kill', '1') == 0
    assert [call['path'] for call in lab.methods('DELETE')] == ['/api/terminals/1']
    assert '1' in out(capsys)[0]


def test_terminals_kill_all_lists_then_needs_yes(lab, capsys):
    """ACC-CLI-177: kill --all lists every terminal and needs --yes."""
    lab.__dict__.update(terminal_lab().__dict__)
    assert run('terminals', 'kill', '--all') == 1
    stdout = out(capsys)[0]
    assert 'would kill terminal 1' in stdout and 'would kill terminal 2' in stdout
    assert lab.methods('DELETE') == []

    assert run('terminals', 'kill', '--all', '--yes') == 0
    assert sorted(call['path'] for call in lab.methods('DELETE')) == ['/api/terminals/1', '/api/terminals/2']


def test_terminals_kill_needs_a_name_or_all(lab):
    """ACC-CLI-177: kill with neither a name nor --all is a usage error, exit 2."""
    with pytest.raises(SystemExit) as usage:
        run('terminals', 'kill')
    assert usage.value.code == 2


# --- ACC-CLI-178-KERNEL-KILL: kernels --------------------------------------


def kernel_lab():
    return FakeLab(
        kernels=[{'id': 'k1', 'name': 'python3'}, {'id': 'k2', 'name': 'ir'}],
        sessions=[session('notes.ipynb', kernel='k1')],
    )


def test_kernels_list_prints_id_name_and_notebook(lab, capsys):
    """ACC-CLI-178: list carries the session path of each kernel, in the table and in JSON."""
    lab.__dict__.update(kernel_lab().__dict__)
    assert run('kernels', 'list') == 0
    stdout = out(capsys)[0]
    assert stdout.splitlines() == [
        'ID\tNAME\tSESSION',
        'k1\tpython3\tnotes.ipynb',
        'k2\tir\t',
    ]
    assert run('kernels', 'list', '--json') == 0
    assert json.loads(out(capsys)[0]) == [
        {'id': 'k1', 'name': 'python3', 'path': 'notes.ipynb'},
        {'id': 'k2', 'name': 'ir', 'path': ''},
    ]


def test_kernels_kill_one(lab, capsys):
    """ACC-CLI-178: kill ID calls the kernels route for that id."""
    lab.__dict__.update(kernel_lab().__dict__)
    assert run('kernels', 'kill', 'k1') == 0
    assert [call['path'] for call in lab.methods('DELETE')] == ['/api/kernels/k1']
    assert 'k1' in out(capsys)[0]


def test_kernels_kill_all_lists_then_needs_yes(lab, capsys):
    """ACC-CLI-178: kill --all lists every kernel and needs --yes."""
    lab.__dict__.update(kernel_lab().__dict__)
    assert run('kernels', 'kill', '--all') == 1
    stdout = out(capsys)[0]
    assert 'would kill kernel k1' in stdout and 'would kill kernel k2' in stdout
    assert lab.methods('DELETE') == []

    assert run('kernels', 'kill', '--all', '--yes') == 0
    assert sorted(call['path'] for call in lab.methods('DELETE')) == ['/api/kernels/k1', '/api/kernels/k2']


def test_kernels_kill_needs_an_id_or_all(lab):
    """ACC-CLI-178: kill with neither an id nor --all is a usage error, exit 2."""
    with pytest.raises(SystemExit) as usage:
        run('kernels', 'kill')
    assert usage.value.code == 2


# --- ACC-CLI-179-HELP-AGENT: help complete for an agent --------------------


def leaves(parser, path=()):
    yield path, parser
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            for name, sub in action.choices.items():
                yield from leaves(sub, path + (name,))


def test_module_help_exits_zero_and_names_the_variables_and_codes():
    """ACC-CLI-179: `python3 -m ... --help` exits 0 with the subcommands, the variables and the exit codes."""
    environment = {**os.environ, 'PYTHON_COLORS': '0'}
    result = subprocess.run(
        [sys.executable, '-m', 'jupyterlab_workspace_manager_extension.cli', '--help'],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=environment,
    )
    assert result.returncode == 0
    for text in (
        'workspaces',
        'terminals',
        'kernels',
        'JUPYTER_SERVER_URL',
        'JUPYTERHUB_SERVICE_PREFIX',
        'JUPYTER_PORT',
        'JUPYTERHUB_API_TOKEN',
        'JPY_API_TOKEN',
        'JUPYTER_TOKEN',
        '0  done',
        '1  refused or failed',
        '2  usage',
    ):
        assert text in result.stdout


def test_every_leaf_help_carries_its_examples_and_every_flag_its_help():
    """ACC-CLI-179: each subcommand has 1-3 worked examples and every argument is documented."""
    expected = {
        ('workspaces', 'list'),
        ('workspaces', 'add'),
        ('workspaces', 'open'),
        ('workspaces', 'describe'),
        ('workspaces', 'remove'),
        ('workspaces', 'clean'),
        ('terminals', 'list'),
        ('terminals', 'kill'),
        ('kernels', 'list'),
        ('kernels', 'kill'),
    }
    found = set()
    for path, parser in leaves(cli._parser()):
        if len(path) == 2:
            found.add(path)
            assert parser.epilog and 'examples:' in parser.epilog, path
            assert 1 <= len([line for line in parser.epilog.splitlines() if line.startswith('  ')]) <= 3, path
            for action in parser._actions:
                if action.dest not in ('help', 'parser'):
                    assert action.help, (path, action.dest)
    assert found == expected


def described(help_text, name):
    """Whether the help carries the indented line that names this command and describes it."""
    return any(
        line.split()[:1] == [name] and len(line.split()) > 1
        for line in help_text.splitlines()
    )


def test_group_help_lists_each_leaf_with_a_line(capsys, monkeypatch):
    """ACC-CLI-179: the top level and each group carry a description line per subcommand."""
    monkeypatch.setenv('PYTHON_COLORS', '0')  # FORCE_COLOR in the environment would wrap the names
    with pytest.raises(SystemExit) as top:
        run('--help')
    assert top.value.code == 0
    top_help = capsys.readouterr().out
    for group, commands in {
        'workspaces': ['list', 'add', 'open', 'describe', 'remove', 'clean'],
        'terminals': ['list', 'kill'],
        'kernels': ['list', 'kill'],
    }.items():
        assert described(top_help, group), group
        with pytest.raises(SystemExit) as helped:
            run(group, '--help')
        assert helped.value.code == 0
        group_help = capsys.readouterr().out
        for command in commands:
            assert described(group_help, command), (group, command)


# --- ACC-CLI-180-SKILL-SHIP: the skill ships in the wheel ------------------


def test_the_skill_exists_with_its_frontmatter_and_stays_short():
    """ACC-CLI-180: the skill file exists, carries name and description, and stays under 30 lines."""
    lines = SKILL.read_text(encoding='utf-8').splitlines()
    assert lines[0] == '---'
    end = lines.index('---', 1)
    frontmatter = {key.strip(): value.strip() for key, value in (line.split(':', 1) for line in lines[1:end])}
    assert frontmatter['name'] == 'jupyterlab-workspace-manager-extension'
    assert 'Use when' in frontmatter['description']
    body = [line for line in lines[end + 1:] if line.strip()]
    assert len(body) < 30
    assert 'jupyterlab-workspace --help' in '\n'.join(body)


def test_the_skill_ships_through_the_wheel_shared_data_table():
    """ACC-CLI-180: pyproject places the skill under share/jupyter/agents/skills, outside the package."""
    text = (ROOT / 'pyproject.toml').read_text(encoding='utf-8')
    section = text.split('[tool.hatch.build.targets.wheel.shared-data]', 1)[1].split('[', 1)[0]
    assert (
        '".agents/skills/jupyterlab-workspace-manager-extension"'
        ' = "share/jupyter/agents/skills/jupyterlab-workspace-manager-extension"' in section
    )
    assert not (ROOT / 'jupyterlab_workspace_manager_extension' / 'SKILL.md').exists()
