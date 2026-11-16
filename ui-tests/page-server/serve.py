"""The page the Galata suite opens in a lab tab, and the store of its comments. playwright.config.js starts it."""
import json
import os
import sys
import tempfile
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

FAVICON = b"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#212121'/><circle cx='16' cy='14' r='7' fill='#d32f2f'/><text x='16' y='17.5' font-family='system-ui, sans-serif' font-size='9' font-weight='700' text-anchor='middle' fill='#fff'>1</text></svg>"
DIR = Path(__file__).resolve().parent
# outside the project: the workstation's test runner mounts the project read-only
STORE = Path(tempfile.mkdtemp(prefix='wm-page-server-')) / 'comments.json'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        # The page may run in a sandboxed lab tab (origin null) and must send
        # its cookies to the proxy, so echo the origin and allow credentials;
        # a plain request keeps the wildcard.
        origin = self.headers.get('Origin')
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')
            self.send_header('Vary', 'Origin')
        else:
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def _opaque_origin(self):
        """A sandboxed iframe sends Origin: null; the sandbox promises no store."""
        if self.headers.get('Origin') == 'null':
            self.send_error(403, 'an opaque origin cannot reach the store')
            return True
        return False

    def do_GET(self):
        if self._opaque_origin():
            return
        if self.path.split('?')[0] == '/icon.svg':
            # the tab icon the page.spec.ts test passes as a URL
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml')
            self.send_header('Content-Length', str(len(FAVICON)))
            self.end_headers()
            self.wfile.write(FAVICON)
            return
        if self.path.split('?')[0] == '/favicon.ico':
            # no favicon: answer 204 and keep it out of the log
            self.send_response(204)
            self.end_headers()
            return
        if self.path.split('?')[0] == '/comments':
            data = STORE.read_bytes() if STORE.exists() else b'[]'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_OPTIONS(self):
        if self._opaque_origin():
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self._opaque_origin():
            return
        if self.path.split('?')[0] != '/comments':
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length') or 0)
        if length > 1_000_000:
            self.send_error(413)
            return
        try:
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, list):
                raise ValueError
        except ValueError:
            self.send_error(400, 'expected a JSON array')
            return
        tmp = STORE.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, indent=1))
        os.replace(tmp, STORE)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if '/favicon.ico' in (fmt % args):
            return
        # one line per request: the handover cannot be verified without it
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))
        sys.stderr.flush()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 47987
    HTTPServer(('127.0.0.1', port), Handler).serve_forever()
