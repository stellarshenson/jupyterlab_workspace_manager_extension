#!/usr/bin/env python3
"""jupyterlab-workspace - manage the workspaces, terminals and kernels of a running JupyterLab.

Finds the lab the way references/reaching-a-running-lab.md prescribes: the
JUPYTER_SERVER_URL, JUPYTERHUB_SERVICE_PREFIX or JUPYTER_PORT variable that is
set names it, and only a matching `jupyter server list` record is used; with no
variable set, the one record carrying a token is the lab. A mismatch is a
refusal, not a guess, so a request never lands in another lab.
"""

import argparse
import datetime
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_PORT = '8888'

# Bounds one network call; a wedged server must not hang an unattended caller.
REQUEST_TIMEOUT_S = 10

# Bounds the `jupyter server list` subprocess.
SERVER_LIST_TIMEOUT_S = 5

# The URL path this extension serves; routes.py and src/api.ts name it too, and
# this module must not import tornado to call it.
NAMESPACE = 'jupyterlab-workspace-manager-extension'
WORKSPACES = '/lab/api/workspaces'
META = '/' + NAMESPACE + '/meta'
PRESENCE = '/' + NAMESPACE + '/presence'
TERMINALS = '/' + NAMESPACE + '/terminals'
COLOURS = ('rose', 'peach', 'lemon', 'mint', 'sky', 'lavender')


class CLIError(Exception):
    """A refusal or a failed request; main reports it on stderr and exits 1."""


def _server_list():
    """Every running server record from `jupyter server list --json`.

    The command prints one JSON object per line; its order carries no meaning.
    """
    try:
        result = subprocess.run(
            ['jupyter', 'server', 'list', '--json'],
            capture_output=True,
            text=True,
            timeout=SERVER_LIST_TIMEOUT_S,
        )
    except (subprocess.TimeoutExpired, OSError):
        return []
    if result.returncode != 0:
        return []
    records = []
    for line in result.stdout.splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            records.append(record)
    return records


def _pick_server(records):
    """The lab's record, or {} when no record exists and the environment must name it.

    The first set variable decides: JUPYTER_SERVER_URL (its port and base path,
    plus JUPYTER_SERVER_ROOT when set), else JUPYTERHUB_SERVICE_PREFIX, else
    JUPYTER_PORT. A variable that matches no record is a refusal. With no
    variable set, exactly one record carrying a token is the lab.
    """
    if not records:
        return {}

    def path(value):
        return str(value).rstrip('/') or '/'

    def first_with_token(matches):
        return next((record for record in matches if record.get('token')), matches[0])

    running = ', '.join(
        f"{record.get('port')}{record.get('base_url', '/')}"
        + ('' if record.get('token') else ' (no token)')
        for record in records
    )

    named = None
    url = os.environ.get('JUPYTER_SERVER_URL', '')
    if url:
        try:
            parsed = urllib.parse.urlsplit(url)
            port = parsed.port
        except ValueError:
            port = None
        if port is not None:
            matches = [
                record
                for record in records
                if record.get('port') == port and path(record.get('base_url', '')) == path(parsed.path)
            ]
            root = os.environ.get('JUPYTER_SERVER_ROOT', '')
            if root:
                matches = [
                    record
                    for record in matches
                    if os.path.abspath(str(record.get('root_dir', ''))) == os.path.abspath(root)
                ]
            named = f'JUPYTER_SERVER_URL={url}', matches
    prefix = os.environ.get('JUPYTERHUB_SERVICE_PREFIX', '')
    if named is None and prefix:
        named = (
            f'JUPYTERHUB_SERVICE_PREFIX={prefix}',
            [record for record in records if path(record.get('base_url', '')) == path(prefix)],
        )
    port = os.environ.get('JUPYTER_PORT', '')
    if named is None and port:
        named = (
            f'JUPYTER_PORT={port}',
            [record for record in records if str(record.get('port')) == port.strip()],
        )

    if named is not None:
        variable, matches = named
        if matches:
            return first_with_token(matches)
        raise CLIError(
            f'no running Jupyter server matches {variable} - is JupyterLab running? Running: {running}'
        )

    with_token = [record for record in records if record.get('token')]
    if len(with_token) == 1:
        return with_token[0]
    raise CLIError(
        'cannot tell which running Jupyter server is the lab - run this in a JupyterLab '
        f'terminal, or set JUPYTER_PORT to its port. Running: {running}'
    )


def _base_url(info):
    """Where the server answers, always on loopback."""
    if info:
        return f"http://127.0.0.1:{info.get('port', DEFAULT_PORT)}{str(info.get('base_url', '/')).rstrip('/')}"
    port = os.environ.get('JUPYTER_PORT', '')
    prefix = os.environ.get('JUPYTERHUB_SERVICE_PREFIX', '')
    if not port and not prefix:
        raise CLIError(
            'no running Jupyter server found and neither JUPYTER_PORT nor '
            'JUPYTERHUB_SERVICE_PREFIX names one - is JupyterLab running?'
        )
    return f"http://127.0.0.1:{port or DEFAULT_PORT}{prefix.rstrip('/')}"


def _token(info):
    """The token that authenticates to the lab.

    The hub variables win: under JupyterHub only the hub-issued token is
    accepted. The addressed record's own token beats JUPYTER_TOKEN, which is
    generic and easily stale.
    """
    for name in ('JUPYTERHUB_API_TOKEN', 'JPY_API_TOKEN'):
        value = os.environ.get(name)
        if value:
            return value
    if 'token' in info:
        return info['token'] or None
    return os.environ.get('JUPYTER_TOKEN') or None


def _lab():
    info = _pick_server(_server_list())
    return _base_url(info), _token(info)


# Requests to the local server bypass any proxy: urlopen follows http_proxy even
# for 127.0.0.1, and would hand the proxy the token.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _request(base_url, token, method, path, payload=None):
    """One API call; the token travels in the Authorization header only."""
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    request = urllib.request.Request(base_url.rstrip('/') + path, data=data, method=method)
    if data is not None:
        request.add_header('Content-Type', 'application/json')
    if token:
        request.add_header('Authorization', f'token {token}')
    try:
        with _OPENER.open(request, timeout=REQUEST_TIMEOUT_S) as reply:
            body = reply.read()
    except urllib.error.HTTPError as error:
        raise CLIError(f'{method} {path} failed: {error.code} {error.reason}') from None
    except OSError as error:
        raise CLIError(f'{method} {path} failed: {error}') from None
    if not body:
        return None
    try:
        return json.loads(body)
    except ValueError:
        raise CLIError(f'{method} {path} answered with something that is not JSON - is the token right?') from None


def _name(value):
    """A workspace id without its leading slash, as the API paths take it."""
    return str(value).lstrip('/')


def _meta_path(name):
    return f'{META}/{urllib.parse.quote(name, safe="")}'


def _workspace_path(name=''):
    return WORKSPACES + (f'/{urllib.parse.quote(name, safe="")}' if name else '')


def _workspaces(base, token):
    reply = _request(base, token, 'GET', WORKSPACES) or {}
    return (reply.get('workspaces') or {}).get('values') or []


def _records(base, token):
    return _request(base, token, 'GET', META) or {}


def _record(records, name):
    return records.get(name) or records.get('/' + name) or {}


def _layout_keys(workspace):
    """The layout keys the workspace holds, in the main area and the down area."""

    def area_keys(area):
        if not area:
            return []
        if area.get('type') == 'tab-area':
            return list(area.get('widgets') or [])
        return [key for child in area.get('children') or [] for key in area_keys(child)]

    data = workspace.get('data') or {}
    layout = data.get('layout-restorer:data') or {}
    return area_keys((layout.get('main') or {}).get('dock')) + list((layout.get('down') or {}).get('widgets') or [])


def _counts(workspace, sessions):
    """Tabs, terminals and kernels the workspace holds, as the panel counts them."""
    keys = _layout_keys(workspace)
    terminals = {key.split(':', 1)[1] for key in keys if key.startswith('terminal:')}
    paths = {key.split(':', 1)[1] for key in keys if key.startswith(('notebook:', 'console:'))}
    kernels = {
        session['kernel']['id']
        for session in sessions
        if session.get('path') in paths
        and session.get('type') in ('notebook', 'console')
        and (session.get('kernel') or {}).get('id')
    }
    return len({key for key in keys if not key.startswith('terminal:')}), len(terminals), len(kernels)


def _age_days(workspace):
    value = (workspace.get('metadata') or {}).get('last_modified')
    if not value:
        return None
    try:
        stamp = datetime.datetime.fromisoformat(value)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=datetime.timezone.utc)
    return (datetime.datetime.now(datetime.timezone.utc) - stamp).total_seconds() / 86400


def _table(header, rows):
    # a record field must not break the row or move the terminal: C0 controls and DEL become spaces
    control = {code: ' ' for code in (*range(32), 127)}
    print('\t'.join(header))
    for row in rows:
        print('\t'.join(str(value).translate(control) for value in row))


def _workspace_rows(base, token):
    records = _records(base, token)
    sessions = _request(base, token, 'GET', '/api/sessions') or []
    rows = []
    for workspace in _workspaces(base, token):
        name = _name((workspace.get('metadata') or {}).get('id', ''))
        record = _record(records, name)
        tabs, terminals, kernels = _counts(workspace, sessions)
        rows.append(
            {
                'name': name,
                'purpose': record.get('purpose', ''),
                'colour': record.get('colour', ''),
                'hidden': bool(record.get('hidden', False)),
                'tabs': tabs,
                'terminals': terminals,
                'kernels': kernels,
            }
        )
    return rows


def _cmd_workspaces_list(args, base, token):
    rows = _workspace_rows(base, token)
    if args.json:
        print(json.dumps(rows, indent=2))
        return
    _table(
        ('NAME', 'PURPOSE', 'COLOUR', 'HIDDEN', 'TABS', 'TERMINALS', 'KERNELS'),
        [
            (row['name'], row['purpose'], row['colour'] or '-', 'yes' if row['hidden'] else 'no',
             row['tabs'], row['terminals'], row['kernels'])
            for row in rows
        ],
    )


def _cmd_workspaces_add(args, base, token):
    name = _name(args.name)
    if any(_name((workspace.get('metadata') or {}).get('id', '')) == name for workspace in _workspaces(base, token)):
        raise CLIError(f'workspace {name} already exists')
    # jupyterlab_server creates a workspace with PUT; its handler has no POST.
    _request(base, token, 'PUT', _workspace_path(name), {'data': {}, 'metadata': {'id': name}})
    change = {}
    if args.purpose is not None:
        change['purpose'] = args.purpose
    if args.colour is not None:
        change['colour'] = args.colour
    if change:
        _request(base, token, 'PATCH', _meta_path(name), change)
    print(f'created workspace {name}')


def _cmd_workspaces_open(args, base, token):
    print(f"{base.rstrip('/')}/lab/workspaces/{urllib.parse.quote(_name(args.name), safe='')}")


def _cmd_workspaces_describe(args, base, token):
    name = _name(args.name)
    if not any(_name((workspace.get('metadata') or {}).get('id', '')) == name for workspace in _workspaces(base, token)):
        raise CLIError(f'workspace {name} does not exist')
    change = {}
    if args.purpose is not None:
        change['purpose'] = args.purpose
    if args.colour is not None:
        change['colour'] = args.colour
    if args.hidden is not None:
        change['hidden'] = args.hidden
    record = _request(base, token, 'PATCH', _meta_path(name), change) if change else _record(_records(base, token), name)
    print(json.dumps(record, indent=2))


def _shown_elsewhere(base, token):
    reply = _request(base, token, 'GET', PRESENCE + '?window=') or {}
    return {_name(workspace) for workspace in reply.get('workspaces') or []}


def _cmd_workspaces_remove(args, base, token):
    name = _name(args.name)
    if name in _shown_elsewhere(base, token):
        raise CLIError(f'workspace {name} is open in another browser window; close it there first')
    if not args.yes:
        raise CLIError(f'would remove workspace {name}; run again with --yes')
    _request(base, token, 'DELETE', _workspace_path(name))
    print(f'removed workspace {name}')


def _cmd_workspaces_clean(args, base, token):
    if not (args.hidden or args.empty or args.older_than is not None):
        args.parser.error('choose at least one of --hidden, --empty, --older-than')
    records = _records(base, token)
    sessions = _request(base, token, 'GET', '/api/sessions') or []
    selected = []
    for workspace in _workspaces(base, token):
        name = _name((workspace.get('metadata') or {}).get('id', ''))
        record = _record(records, name)
        tabs, terminals, kernels = _counts(workspace, sessions)
        if (
            (args.hidden and record.get('hidden'))
            or (args.empty and not (tabs or terminals or kernels))
            or (args.older_than is not None and (_age_days(workspace) or 0) > args.older_than)
        ):
            selected.append(name)
    if not selected:
        print('no workspace matches')
        return
    shown = _shown_elsewhere(base, token)
    for name in selected:
        if name in shown:
            print(f'skipped workspace {name}: open in another browser window')
            continue
        if args.yes:
            _request(base, token, 'DELETE', _workspace_path(name))
            print(f'removed workspace {name}')
        else:
            print(f'would remove workspace {name}')
    if not args.yes:
        raise CLIError('nothing was removed; run again with --yes')


def _terminals(base, token):
    return _request(base, token, 'GET', TERMINALS) or []


def _cmd_terminals_list(args, base, token):
    rows = [
        {'name': item.get('name', ''), 'process': item.get('process') or '', 'last_activity': item.get('last_activity', '')}
        for item in _terminals(base, token)
    ]
    if args.json:
        print(json.dumps(rows, indent=2))
        return
    _table(('NAME', 'PROCESS', 'LAST ACTIVITY'), [(row['name'], row['process'], row['last_activity']) for row in rows])


def _cmd_terminals_kill(args, base, token):
    if bool(args.name) == bool(args.all):
        args.parser.error('give a terminal name or --all')
    if args.all:
        names = [item['name'] for item in _terminals(base, token)]
        if not names:
            print('no terminals')
            return
        for name in names:
            if args.yes:
                _request(base, token, 'DELETE', f'/api/terminals/{urllib.parse.quote(name, safe="")}')
                print(f'killed terminal {name}')
            else:
                print(f'would kill terminal {name}')
        if not args.yes:
            raise CLIError('nothing was killed; run again with --yes')
        return
    name = _name(args.name)
    _request(base, token, 'DELETE', f'/api/terminals/{urllib.parse.quote(name, safe="")}')
    print(f'killed terminal {name}')


def _kernel_rows(base, token):
    kernels = _request(base, token, 'GET', '/api/kernels') or []
    sessions = _request(base, token, 'GET', '/api/sessions') or []
    paths = {}
    for session in sessions:
        kernel = session.get('kernel') or {}
        if kernel.get('id'):
            paths[kernel['id']] = session.get('path', '')
    return [
        {'id': kernel.get('id', ''), 'name': kernel.get('name', ''), 'path': paths.get(kernel.get('id'), '')}
        for kernel in kernels
    ]


def _cmd_kernels_list(args, base, token):
    rows = _kernel_rows(base, token)
    if args.json:
        print(json.dumps(rows, indent=2))
        return
    _table(('ID', 'NAME', 'SESSION'), [(row['id'], row['name'], row['path']) for row in rows])


def _cmd_kernels_kill(args, base, token):
    if bool(args.id) == bool(args.all):
        args.parser.error('give a kernel id or --all')
    ids = [row['id'] for row in _kernel_rows(base, token)] if args.all else [_name(args.id)]
    if not ids:
        print('no kernels')
        return
    for kernel_id in ids:
        if args.all and not args.yes:
            print(f'would kill kernel {kernel_id}')
            continue
        _request(base, token, 'DELETE', f'/api/kernels/{urllib.parse.quote(kernel_id, safe="")}')
        print(f'killed kernel {kernel_id}')
    if args.all and not args.yes:
        raise CLIError('nothing was killed; run again with --yes')


ENVIRONMENT = """environment:
  JUPYTER_SERVER_URL, JUPYTERHUB_SERVICE_PREFIX, JUPYTER_PORT
                       name the lab; the first one set decides, and a value that
                       matches no running server is a refusal
  JUPYTER_SERVER_ROOT  the lab's root directory, checked with JUPYTER_SERVER_URL
  JUPYTERHUB_API_TOKEN, JPY_API_TOKEN, JUPYTER_TOKEN
                       the token, in that order; sent in the Authorization
                       header only and never printed

exit codes:
  0  done
  1  refused or failed
  2  usage"""


def _examples(text):
    return 'examples:\n' + text


def _parser():
    parser = argparse.ArgumentParser(
        prog='jupyterlab-workspace',
        description='Manage the workspaces, terminals and kernels of a running JupyterLab.',
        epilog=ENVIRONMENT,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    groups = parser.add_subparsers(dest='group', required=True)

    workspaces = groups.add_parser(
        'workspaces',
        help='list, add, open, describe, remove or clean workspaces',
        description='Manage the workspaces of the lab the environment names.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ws = workspaces.add_subparsers(dest='command', required=True)

    p = ws.add_parser(
        'list',
        help='print every workspace with its record and counts',
        description='Print one line per workspace: name, purpose, colour, hidden state and the '
        'number of tabs, terminals and kernels. --json prints the same facts as data.',
        epilog=_examples(
            '  jupyterlab-workspace workspaces list\n  jupyterlab-workspace workspaces list --json'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--json', action='store_true', help='print JSON instead of the table')
    p.set_defaults(handler=_cmd_workspaces_list)

    p = ws.add_parser(
        'add',
        help='create a workspace and write its record',
        description='Create the named workspace and write --purpose and --colour to its record. '
        'An existing name is refused and nothing is written.',
        epilog=_examples(
            '  jupyterlab-workspace workspaces add fb-review\n'
            '  jupyterlab-workspace workspaces add fb-review --purpose "Review the feedback" --colour mint'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('name', help='the workspace name')
    p.add_argument('--purpose', help='a description of at most 100 characters')
    p.add_argument('--colour', choices=COLOURS, help='the colour strip: ' + ', '.join(COLOURS))
    p.set_defaults(handler=_cmd_workspaces_add)

    p = ws.add_parser(
        'open',
        help='print the lab URL that switches this window to the workspace',
        description='Print the lab URL that opens the named workspace, and nothing else.',
        epilog=_examples('  jupyterlab-workspace workspaces open fb-review'),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('name', help='the workspace name')
    p.set_defaults(handler=_cmd_workspaces_open)

    p = ws.add_parser(
        'describe',
        help='set fields of a workspace record and print the record',
        description='Set --purpose, --colour, --hide or --show on the record of the named '
        'workspace and print the record as written. With no field, print the record as it is.',
        epilog=_examples(
            '  jupyterlab-workspace workspaces describe fb-review --purpose "Review the feedback"\n'
            '  jupyterlab-workspace workspaces describe fb-review --colour mint\n'
            '  jupyterlab-workspace workspaces describe fb-review --hide'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('name', help='the workspace name')
    p.add_argument('--purpose', help='a description of at most 100 characters')
    p.add_argument('--colour', choices=COLOURS, help='the colour strip: ' + ', '.join(COLOURS))
    shown = p.add_mutually_exclusive_group()
    shown.add_argument('--hide', dest='hidden', action='store_const', const=True, help='hide the workspace in the panel')
    shown.add_argument('--show', dest='hidden', action='store_const', const=False, help='show the workspace in the panel')
    p.set_defaults(handler=_cmd_workspaces_describe, hidden=None)

    p = ws.add_parser(
        'remove',
        help='delete a workspace; needs --yes and refuses while another window shows it',
        description='Delete the named workspace and its file. Refuses while a presence record '
        'shows it open in another browser window, and does nothing without --yes. Cannot be undone.',
        epilog=_examples(
            '  jupyterlab-workspace workspaces remove fb-review\n'
            '  jupyterlab-workspace workspaces remove fb-review --yes'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('name', help='the workspace name')
    p.add_argument('--yes', action='store_true', help='delete it; without this the command refuses')
    p.set_defaults(handler=_cmd_workspaces_remove)

    p = ws.add_parser(
        'clean',
        help='delete the workspaces the selectors name; lists them first',
        description='Delete every workspace that --hidden, --empty or --older-than DAYS selects. '
        'Prints what it would delete and deletes only with --yes. Cannot be undone.',
        epilog=_examples(
            '  jupyterlab-workspace workspaces clean --hidden\n'
            '  jupyterlab-workspace workspaces clean --empty --older-than 30 --yes'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--hidden', action='store_true', help='select workspaces whose record hides them')
    p.add_argument('--empty', action='store_true', help='select workspaces with no tabs, terminals or kernels')
    p.add_argument('--older-than', type=int, metavar='DAYS', help='select workspaces last modified more than DAYS days ago')
    p.add_argument('--yes', action='store_true', help='delete them; without this the command lists and refuses')
    p.set_defaults(handler=_cmd_workspaces_clean, parser=p)

    terminals = groups.add_parser(
        'terminals',
        help='list or kill terminals',
        description='Manage the terminals of the lab the environment names.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ts = terminals.add_subparsers(dest='command', required=True)

    p = ts.add_parser(
        'list',
        help='print every terminal with its name and foreground process',
        description='Print one line per terminal: name, foreground process and last activity. '
        '--json prints the same facts as data.',
        epilog=_examples('  jupyterlab-workspace terminals list\n  jupyterlab-workspace terminals list --json'),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--json', action='store_true', help='print JSON instead of the table')
    p.set_defaults(handler=_cmd_terminals_list)

    p = ts.add_parser(
        'kill',
        help='shut down one terminal, or every terminal with --all',
        description='Shut down the named terminal, or every terminal with --all. --all prints what '
        'it would kill and needs --yes. Cannot be undone.',
        epilog=_examples(
            '  jupyterlab-workspace terminals kill 1\n  jupyterlab-workspace terminals kill --all --yes'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('name', nargs='?', help='the terminal name')
    p.add_argument('--all', action='store_true', help='kill every terminal; needs --yes')
    p.add_argument('--yes', action='store_true', help='kill them; without this --all lists and refuses')
    p.set_defaults(handler=_cmd_terminals_kill, parser=p)

    kernels = groups.add_parser(
        'kernels',
        help='list or kill kernels',
        description='Manage the kernels of the lab the environment names.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ks = kernels.add_subparsers(dest='command', required=True)

    p = ks.add_parser(
        'list',
        help='print every kernel with its id, name and notebook',
        description='Print one line per kernel: id, kernelspec name and the notebook or console '
        'its session serves. --json prints the same facts as data.',
        epilog=_examples('  jupyterlab-workspace kernels list\n  jupyterlab-workspace kernels list --json'),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--json', action='store_true', help='print JSON instead of the table')
    p.set_defaults(handler=_cmd_kernels_list)

    p = ks.add_parser(
        'kill',
        help='shut down one kernel, or every kernel with --all',
        description='Shut down the kernel with the given id, or every kernel with --all. --all '
        'prints what it would kill and needs --yes. Cannot be undone.',
        epilog=_examples(
            '  jupyterlab-workspace kernels kill 5c9d-...\n  jupyterlab-workspace kernels kill --all --yes'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('id', nargs='?', help='the kernel id')
    p.add_argument('--all', action='store_true', help='kill every kernel; needs --yes')
    p.add_argument('--yes', action='store_true', help='kill them; without this --all lists and refuses')
    p.set_defaults(handler=_cmd_kernels_kill, parser=p)

    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    try:
        base, token = _lab()
        args.handler(args, base, token)
    except CLIError as error:
        print(f'jupyterlab-workspace: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
