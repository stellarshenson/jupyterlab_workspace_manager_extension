"""The newest OSC 0 or 2 title of a terminal's pty, read from terminado's own reconnect buffer.

terminado appends every chunk it reads from the pty to `PtyWithClients.read_buffer`, a
deque, whether or not a browser shows the terminal. The route replaces that deque with a
`TitleBuffer` whose append also parses the chunk, so a title keeps updating while every
window has left the workspace.
"""
from collections import deque

ESC = "\x1b"
BEL = "\x07"
ST = "\x1b\\"
TITLE_MAX = 256
# a full title with its OSC prefix and the ESC of a split ST
PENDING_MAX = TITLE_MAX + len("\x1b]2;") + 1
# a chunk made only of titles is hostile output; 64 of them bound the work per chunk
TITLES_PER_CHUNK = 64


def sanitize(raw):
    """A title with C0, C1 and DEL dropped, at most TITLE_MAX characters; None when nothing is left."""
    clean = "".join(ch for ch in raw if ch >= " " and not ("\x7f" <= ch <= "\x9f"))
    return clean[:TITLE_MAX] or None


class TitleTap:
    """The newest OSC 0 or 2 title in a stream of str chunks."""

    __slots__ = ("pending", "title")

    def __init__(self):
        self.pending = ""
        self.title = None

    def feed(self, s):
        """Parse one chunk; a parser fault is dropped, never raised into the pty read."""
        try:
            if self.pending:
                s, self.pending = self.pending + s, ""
                self._scan(s, 0)
                return
            i = s.find("\x1b]")
            if i < 0:
                if s.endswith(ESC):
                    self.pending = ESC
                return
            self._scan(s, i)
        except Exception:
            self.pending = ""

    def _scan(self, s, i):
        n = len(s)
        budget = TITLES_PER_CHUNK
        while True:
            j = s.find("\x1b]", i)
            if j < 0:
                if s.endswith(ESC):
                    self.pending = ESC
                return
            budget -= 1
            if budget < 0:
                return
            k = j + 2
            m = k
            while m < n and s[m].isdigit():
                m += 1
            if m >= n:
                self._hold(s[j:])
                return
            if s[m] != ";":
                i = j + 2
                continue
            code = s[k:m]
            start = m + 1
            bel = s.find(BEL, start)
            # ST is searched only up to the BEL: searching the whole tail for both would
            # rescan the chunk once per title, O(n^2) on a chunk made of titles
            st = s.find(ST, start, bel) if bel >= 0 else s.find(ST, start)
            if bel < 0 and st < 0:
                self._hold(s[j:])
                return
            if st >= 0:
                end, after = st, st + 2
            else:
                end, after = bel, bel + 1
            if code in ("0", "2"):
                self.title = sanitize(s[start:end])
            i = after
            if i >= n:
                return

    def _hold(self, tail):
        # keep the start of an over-long candidate: a split title truncates to TITLE_MAX instead of
        # dropping, while memory stays bounded by PENDING_MAX
        if len(tail) > PENDING_MAX:
            tail = tail[:PENDING_MAX - 1] + ESC if tail.endswith(ESC) else tail[:PENDING_MAX]
        self.pending = tail


class TitleBuffer(deque):
    """A pty's reconnect buffer that also keeps the newest OSC 0 or 2 title of its stream."""

    def __init__(self, iterable=(), maxlen=None):
        super().__init__(iterable, maxlen)
        self.tap = TitleTap()

    @property
    def title(self):
        return self.tap.title

    def append(self, s):
        # the chunk always reaches the buffer and every attached websocket, even if the parser faults
        self.tap.feed(s)
        super().append(s)


def title_of(pty):
    """The pty's newest title, attaching the tap on the first read; None when it has no deque read_buffer."""
    buffer = getattr(pty, "read_buffer", None)
    if not isinstance(buffer, deque):
        return None
    if not isinstance(buffer, TitleBuffer):
        buffer = pty.read_buffer = TitleBuffer(buffer, maxlen=buffer.maxlen)
    return buffer.title
