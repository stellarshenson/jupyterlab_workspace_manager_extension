"""The pty title tap: OSC 0 and 2 titles parsed from terminado's own str chunks."""
from collections import deque

from jupyterlab_workspace_manager_extension.titles import (
    BEL,
    PENDING_MAX,
    ST,
    TITLE_MAX,
    TitleBuffer,
    TitleTap,
    title_of,
)


def tap_of(*chunks):
    """The tap after feeding each chunk in order."""
    tap = TitleTap()
    for chunk in chunks:
        tap.feed(chunk)
    return tap


def test_every_split_boundary_of_a_bel_and_an_st_title():
    """ACC-PANEL-332-TABNAMES-UPDATE: OSC 0 and 2 titles terminated by BEL and by ST survive a cut at any character."""
    bodies = ["\x1b]0;A\x07", "\x1b]2;b\x1b\\", "\x1b]2;café\x07"]
    titles = ["A", "b", "café"]
    for body, title in zip(bodies, titles):
        whole = "left" + body + "right"
        for cut in range(1, len(whole)):
            assert tap_of(whole[:cut], whole[cut:]).title == title, (body, cut)
    # a character at a time, including the ST two-character terminator
    tap = TitleTap()
    for ch in "\x1b]2;slow\x1b\\":
        tap.feed(ch)
    assert tap.title == "slow"


def test_codes_other_than_0_and_2_are_ignored():
    """ACC-PANEL-332-TABNAMES-UPDATE: OSC 1, 7 and 8 payloads are not titles and leave the newest one alone."""
    tap = tap_of("\x1b]2;keep\x07\x1b]1;icon\x07\x1b]7;/path\x07\x1b]8;;http://e\x1b\\")

    assert tap.title == "keep"
    assert tap_of("\x1b]1;only-icon\x07\x1b]7;cwd\x07\x1b]8;;url\x1b\\").title is None


def test_the_newest_title_wins():
    """ACC-PANEL-332-TABNAMES-UPDATE: each new title replaces the previous one."""
    assert tap_of("\x1b]2;old\x07\x1b]0;new\x07").title == "new"


def test_an_empty_payload_clears_the_title():
    """ACC-PANEL-332-TABNAMES-UPDATE: a title with nothing left after the control characters clears to None."""
    tap = tap_of("\x1b]2;name\x07")
    assert tap.title == "name"

    tap.feed("\x1b]2;\x07")

    assert tap.title is None


def test_a_long_title_is_capped():
    """ACC-PANEL-332-TABNAMES-UPDATE: a 100k-character title stores TITLE_MAX characters."""
    assert tap_of("\x1b]2;" + "x" * 100000 + "\x07").title == "x" * TITLE_MAX


def test_an_unterminated_candidate_keeps_a_bounded_pending():
    """ACC-PANEL-332-TABNAMES-UPDATE: a 100k-character unterminated candidate leaves pending at most PENDING_MAX."""
    tap = tap_of("\x1b]2;" + "y" * 100000)

    assert len(tap.pending) <= PENDING_MAX
    assert tap.title is None


def test_a_split_over_the_pending_cap_is_truncated_not_dropped():
    """ACC-PANEL-332-TABNAMES-UPDATE: a 256- or 300-character title split mid-title or inside ST stores its first TITLE_MAX characters."""
    for size in (TITLE_MAX, 300):
        payload = "x" * size
        capped = payload[:TITLE_MAX]
        for terminator in (BEL, ST):
            whole = "\x1b]2;" + payload + terminator
            cuts = [len("\x1b]2;") + 253]
            if terminator == ST:
                cuts.append(len(whole) - 1)
            for cut in cuts:
                tap = TitleTap()
                tap.feed(whole[:cut])
                tap.feed(whole[cut:])

                assert tap.title == capped, (size, repr(terminator), cut)


def test_control_characters_are_stripped():
    """ACC-PANEL-332-TABNAMES-UPDATE: C0, C1 and DEL, newline and tab included, are dropped from a title."""
    assert tap_of("\x1b]2;a\tb\nc\r\x01d\x7fe\x9ff\x07").title == "abcdef"


def test_a_chunk_of_titles_parses_at_most_64():
    """ACC-PANEL-332-TABNAMES-UPDATE: 10k titles in one chunk stop at TITLES_PER_CHUNK, so hostile output stays cheap."""
    chunk = "".join(f"\x1b]2;t{i}\x07" for i in range(10000))

    assert tap_of(chunk).title == "t63"


def test_a_raising_feed_is_swallowed_and_the_chunk_is_appended():
    """ACC-PANEL-332-TABNAMES-UPDATE: a parser fault never raises into the pty read and never loses the chunk."""
    buffer = TitleBuffer(maxlen=4)
    buffer.tap.pending = "held"
    # bytes make the str search raise; the tap swallows it and resets the pending tail
    buffer.append(b"\xff\x1b]2;")

    assert buffer.tap.pending == ""
    assert list(buffer) == [b"\xff\x1b]2;"]
    # the next str chunk still parses
    buffer.append("\x1b]2;after\x07")

    assert buffer.title == "after"


def test_title_of_attaches_the_tap_once():
    """ACC-PANEL-332-TABNAMES-UPDATE: title_of returns None without a deque buffer and replaces a plain deque once."""

    class Pty:
        pass

    pty = Pty()
    assert title_of(pty) is None

    pty.read_buffer = ["not", "a", "deque"]
    assert title_of(pty) is None

    pty.read_buffer = deque(["old"], maxlen=1000)
    assert title_of(pty) is None
    assert isinstance(pty.read_buffer, TitleBuffer)
    assert pty.read_buffer.maxlen == 1000
    assert list(pty.read_buffer) == ["old"]

    attached = pty.read_buffer
    pty.read_buffer.append("\x1b]2;live\x07")

    assert title_of(pty) == "live"
    assert pty.read_buffer is attached
