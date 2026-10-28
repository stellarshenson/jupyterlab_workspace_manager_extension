"""Build the SVG models and the design proposal page.

Run from the repository root: python docs/design/build.py
Writes docs/design/svg/*.svg (standalone, dark by default, light under
prefers-color-scheme) and docs/design/workspace-manager-design.html, which
inlines every model twice, once per theme.
"""

from html import escape
from textwrap import wrap
from pathlib import Path

HERE = Path(__file__).parent
SVG_DIR = HERE / "svg"
FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"
W = 300  # sidebar width of the models

# Token values: dark = Galaxa Dark Theme - Steel, read from the live lab on 2026-10-23 and from its
# theme CSS on 2026-10-28 (b1, warn1, warn2, info1, inv0); light = stock JupyterLab Light.
# rose ... lavender are the pastel strips of the first drafts, kept for the appendix models only.
THEMES = {
    "dark": {
        "l0": "#252b32", "l1": "#303841", "l2": "#404b54", "l3": "#4d5a65", "l4": "#5d6d7a",
        "f0": "#c3c3c3", "f1": "#a5a5a5", "f2": "#7d8791",
        "b2": "#404b54", "b3": "#252b32",
        "brand1": "#2196f3", "brand2": "#64b5f6",
        "ok": "#4caf50", "err": "#f44336", "glyph": "#bdbdbd",
        "rose": "#e8bbc6", "peach": "#ddc2a7", "lemon": "#ccc8a6",
        "mint": "#b3cdb1", "sky": "#a5cce5", "lavender": "#cfc1e1",
        "nb": "#ef6c00", "md": "#64b5f6", "py": "#ffca28",
        "b1": "#404b54", "warn1": "#ff9800", "warn2": "#ffb74d", "info1": "#00bcd4", "inv0": "#1e2124",
    },
    "light": {
        "l0": "#ffffff", "l1": "#ffffff", "l2": "#eeeeee", "l3": "#bdbdbd", "l4": "#757575",
        "f0": "rgba(0,0,0,1)", "f1": "rgba(0,0,0,.87)", "f2": "rgba(0,0,0,.54)",
        "b2": "#e0e0e0", "b3": "#eeeeee",
        "brand1": "#1976d2", "brand2": "#42a5f5",
        "ok": "#388e3c", "err": "#d32f2f", "glyph": "#616161",
        "rose": "#e39fb1", "peach": "#d2ab82", "lemon": "#bab56d",
        "mint": "#87c086", "sky": "#77bae0", "lavender": "#bfa9da",
        "nb": "#ef6c00", "md": "#1976d2", "py": "#f9a825",
        "b1": "#bdbdbd", "warn1": "#f57c00", "warn2": "#ffb74d", "info1": "#0097a7", "inv0": "#ffffff",
    },
}


def css_vars(theme: str) -> str:
    return ";".join(f"--m-{k}:{v}" for k, v in THEMES[theme].items())


def v(name: str) -> str:
    return f"var(--m-{name})"


def tint(colour: str, pct: int, base: str = "l1") -> str:
    return f"color-mix(in srgb, {v(colour)} {pct}%, {v(base)})"


class Svg:
    def __init__(self, width: int, height: int, title: str):
        self.w, self.h, self.title = width, height, title
        self.parts: list[str] = []
        self.ids = 0

    def uid(self, prefix: str) -> str:
        self.ids += 1
        return f"{prefix}-{self.ids}"

    def add(self, s: str) -> None:
        self.parts.append(s)

    def rect(self, x, y, w, h, fill, rx=0, stroke=None, sw=1, dash=None):
        st = f"fill:{fill}"
        if stroke:
            st += f";stroke:{stroke};stroke-width:{sw}"
            if dash:
                st += f";stroke-dasharray:{dash}"
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" style="{st}"/>')

    def line(self, x1, y1, x2, y2, colour, sw=1):
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" style="stroke:{colour};stroke-width:{sw}"/>')

    def text(self, x, y, s, colour="f1", size=12, weight=400, anchor="start", italic=False, spacing=0, upper=False,
             mono=False, opacity=None):
        if upper:
            s = s.upper()
        st = f"fill:{v(colour) if not colour.startswith(('var', 'color', '#')) else colour};font-size:{size}px;font-weight:{weight}"
        if italic:
            st += ";font-style:italic"
        if spacing:
            st += f";letter-spacing:{spacing}px"
        if mono:
            st += f";font-family:{MONO}"
        if opacity is not None:
            st += f";opacity:{opacity}"
        self.add(f'<text x="{x}" y="{y}" text-anchor="{anchor}" style="{st}">{escape(s)}</text>')

    def runs(self, x, y, parts, anchor="start"):
        """parts: (text, colour, size, weight, italic, gap before)."""
        spans = []
        for text, colour, size, weight, italic, gap in parts:
            st = f"fill:{v(colour)};font-size:{size}px;font-weight:{weight}"
            if italic:
                st += ";font-style:italic"
            spans.append(f'<tspan dx="{gap}" style="{st}">{escape(text)}</tspan>')
        self.add(f'<text x="{x}" y="{y}" text-anchor="{anchor}">{"".join(spans)}</text>')

    def raw(self, s: str) -> None:
        self.add(s)

    def body(self) -> str:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
            f'viewBox="0 0 {self.w} {self.h}" role="img" aria-label="{escape(self.title)}" '
            f'style="font-family:{FONT}">'
            f'<rect width="{self.w}" height="{self.h}" style="fill:{v("l1")}"/>'
            + "".join(self.parts)
            + "</svg>"
        )

    def standalone(self) -> str:
        style = (
            f"<style>svg{{{css_vars('dark')}}}"
            f"@media (prefers-color-scheme: light){{svg{{{css_vars('light')}}}}}</style>"
        )
        b = self.body()
        i = b.index(">") + 1
        return b[:i] + style + b[i:]


# ---------- glyphs (16px box, top-left at x, y) ----------

def g_caret(s: Svg, x, y, open_=True, colour="f2"):
    pts = f"{x+3},{y+5} {x+11},{y+5} {x+7},{y+10}" if open_ else f"{x+5},{y+3} {x+10},{y+7.5} {x+5},{y+12}"
    s.raw(f'<polygon points="{pts}" style="fill:{v(colour)}"/>')


def g_terminal(s: Svg, x, y, colour="glyph"):
    s.rect(x + 1, y + 2.5, 14, 11, "none", rx=1.5, stroke=v(colour), sw=1.2)
    s.raw(f'<polyline points="{x+4},{y+6} {x+6.5},{y+8} {x+4},{y+10}" style="fill:none;stroke:{v(colour)};stroke-width:1.2"/>')
    s.line(x + 8, y + 10.5, x + 11.5, y + 10.5, v(colour), 1.2)


def g_kernel(s: Svg, x, y, state="ok"):
    s.raw(f'<circle cx="{x+8}" cy="{y+8}" r="5.5" style="fill:none;stroke:{v("glyph")};stroke-width:1.2"/>')
    s.raw(f'<circle cx="{x+8}" cy="{y+8}" r="2.6" style="fill:{v(state)}"/>')


def g_file(s: Svg, x, y, colour):
    s.raw(f'<path d="M{x+3} {y+1.5}h6.5l3.5 3.5v9.5h-10z" style="fill:{v(colour)}"/>')
    s.raw(f'<path d="M{x+9.5} {y+1.5}v3.5h3.5" style="fill:none;stroke:{v("l1")};stroke-width:1"/>')


def g_tabs(s: Svg, x, y, colour="f2"):
    s.raw(f'<path d="M{x+3.5} {y+2.5}h6l3 3v8.5h-9z M{x+9.5} {y+2.5}v3h3" style="fill:none;stroke:{v(colour)};stroke-width:1.1"/>')


def g_dots(s: Svg, x, y, colour="glyph"):
    for dx in (4, 8, 12):
        s.raw(f'<circle cx="{x+dx}" cy="{y+8}" r="1.3" style="fill:{v(colour)}"/>')


def g_filter(s: Svg, x, y, colour="glyph"):
    s.raw(f'<path d="M{x+2} {y+3}h12l-4.6 5.4v4.6l-2.8 1.4v-6z" style="fill:none;stroke:{v(colour)};stroke-width:1.2;stroke-linejoin:round"/>')


def g_refresh(s: Svg, x, y, colour="glyph"):
    s.raw(f'<path d="M{x+13} {y+8}a5 5 0 1 1 -1.5 -3.6" style="fill:none;stroke:{v(colour)};stroke-width:1.3"/>')
    s.raw(f'<polygon points="{x+12.8},{y+1.8} {x+13.4},{y+5.6} {x+9.6},{y+5.2}" style="fill:{v(colour)}"/>')


def g_plus(s: Svg, x, y, colour="glyph"):
    s.raw(f'<path d="M{x+8} {y+2.5}v11M{x+2.5} {y+8}h11" style="fill:none;stroke:{v(colour)};stroke-width:1.4"/>')


def g_eye(s: Svg, x, y, colour="glyph", off=False):
    s.raw(f'<path d="M{x+1.5} {y+8}c2.2 -3.6 4.3 -5 6.5 -5s4.3 1.4 6.5 5c-2.2 3.6 -4.3 5 -6.5 5s-4.3 -1.4 -6.5 -5z" style="fill:none;stroke:{v(colour)};stroke-width:1.2"/>')
    s.raw(f'<circle cx="{x+8}" cy="{y+8}" r="2" style="fill:{v(colour)}"/>')
    if off:
        s.line(x + 2.5, y + 13.5, x + 13.5, y + 2.5, v(colour), 1.3)


def g_open(s: Svg, x, y, colour="glyph"):
    s.raw(f'<path d="M{x+7} {y+3}h-4v10h10v-4" style="fill:none;stroke:{v(colour)};stroke-width:1.2"/>')
    s.raw(f'<path d="M{x+9} {y+2.5}h4.5v4.5M{x+13.5} {y+2.5}l-6 6" style="fill:none;stroke:{v(colour)};stroke-width:1.2"/>')


# Candidates for Open workspace (this window goes to that workspace). Rejected: an arrow into a
# box (read as exit), two opposite arrows (rejected without a reason given)
def g_folder_open(s: Svg, x, y, colour="glyph"):
    s.raw(f'<path d="M{x+1.5} {y+12.5}V{y+3.5}h4l1.5 1.5h6v2M{x+1.5} {y+12.5}l2.2-5.5h11l-2.2 5.5z" style="fill:none;stroke:{v(colour)};stroke-width:1.2;stroke-linejoin:round"/>')


def g_go(s: Svg, x, y, colour="glyph"):
    s.raw(f'<circle cx="{x+8}" cy="{y+8}" r="6" style="fill:none;stroke:{v(colour)};stroke-width:1.2"/>')
    s.raw(f'<path d="M{x+5} {y+8}h5.5M{x+8.3} {y+5.5}l2.5 2.5-2.5 2.5" style="fill:none;stroke:{v(colour)};stroke-width:1.2;stroke-linejoin:round"/>')


def g_panes(s: Svg, x, y, colour="glyph"):
    for k, (px, py) in enumerate(((2, 2), (8.5, 2), (2, 8.5), (8.5, 8.5))):
        s.rect(x + px, y + py, 5.5, 5.5, v(colour) if k == 0 else "none", rx=1, stroke=v(colour), sw=1.1)


def g_layout(s: Svg, x, y, colour="glyph"):
    """A lab window: a filled side bar and the main area; a chevron in a window read as a terminal."""
    s.rect(x + 1.5, y + 2.5, 13, 11, "none", rx=1.5, stroke=v(colour), sw=1.2)
    s.rect(x + 1.5, y + 2.5, 4, 11, v(colour), rx=1)
    s.line(x + 8, y + 8, x + 12.5, y + 8, v(colour), 1.2)


OPEN_ICONS = [("1. Open folder", g_folder_open), ("2. Arrow in a circle", g_go),
              ("3. Panes", g_panes), ("4. Layout", g_layout)]
g_open_ws = g_go  # candidate 2, picked by the Star Colonel on 2026-10-24


def g_pencil(s: Svg, x, y, colour="glyph"):
    s.raw(f'<path d="M{x+2.5} {y+13.5}l0.8-3.2 7.6-7.6 2.4 2.4-7.6 7.6zM{x+9.4} {y+4.2}l2.4 2.4" style="fill:none;stroke:{v(colour)};stroke-width:1.2;stroke-linejoin:round"/>')


def g_bin(s: Svg, x, y, colour="glyph"):
    s.raw(f'<path d="M{x+2.5} {y+4.5}h11M{x+6} {y+4.5}v-2h4v2M{x+4} {y+4.5}l0.8 9h6.4l0.8-9M{x+7} {y+7}v4.5M{x+9} {y+7}v4.5" style="fill:none;stroke:{v(colour)};stroke-width:1.2;stroke-linejoin:round"/>')


def g_swatch(s: Svg, x, y, colour):
    """The colour swatch of jupyterlab_colourful_tab_extension's Tab Colour menu: a 12px rounded square, 1px grey border."""
    s.rect(x + 2, y + 2, 12, 12, v(colour), rx=2, stroke=v("l4"))


def g_closeall(s: Svg, x, y, colour="glyph"):
    s.rect(x + 2, y + 4, 10, 9, "none", rx=1, stroke=v(colour), sw=1.1)
    s.raw(f'<path d="M{x+4} {y+4}v-1.5h10v9h-2" style="fill:none;stroke:{v(colour)};stroke-width:1.1"/>')
    s.raw(f'<path d="M{x+4.8} {y+6.3}l4.4 4.4M{x+9.2} {y+6.3}l-4.4 4.4" style="fill:none;stroke:{v(colour)};stroke-width:1.1"/>')


def g_unassigned(s: Svg, x, y, colour="f2"):
    s.raw(f'<circle cx="{x+8}" cy="{y+8}" r="5" style="fill:none;stroke:{v(colour)};stroke-width:1.2;stroke-dasharray:2 1.6"/>')


def icon_button(s: Svg, x, y, glyph, active=False, hover=False, **kw):
    """24x24 header action, glyph 16 centred (design system: 14px glyph in 24px box)."""
    if active or hover:
        s.rect(x, y, 24, 24, v("l3"), rx=2)
    glyph(s, x + 4, y + 4, colour="brand1" if active else ("f1" if hover else "glyph"), **kw)


# ---------- sample data ----------

DEFAULT_WS = {
    "name": "default", "colour": "sky", "purpose": "Extension development", "age": "now",
    "docs": [("md", "README.md", "docs"), ("md", "brief.md", "docs"), ("nb", "design.ipynb", "notebooks")],
    "terms": [("claude", "7", "now"), ("claude", "11", "2m"), ("fish", "13", "3h"), ("claude", "14", "12m"), ("fish", "15", "1d")],
    "kernels": [("Python 3", "design.ipynb", "5m", "ok")],
}
# newest first, as the panel orders them; auto-6 carries the hover state
OTHERS = [
    {"name": "iconprobe2", "colour": "mint", "purpose": "", "age": "8h", "n": (1, 0, 0)},
    {"name": "auto-6", "colour": "peach", "purpose": "Firmware upload tests", "age": "3d", "n": (0, 1, 0)},
    {"name": "wf-regression-hist-1", "colour": "lemon", "purpose": "Regression history workflow", "age": "3d", "n": (2, 0, 1)},
    {"name": "fb-exp-panels-base", "colour": "lavender", "purpose": "", "age": "4d", "n": (0, 0, 0)},
]
HOVER = "auto-6"


def age_colour(age: str) -> str:
    return "brand1" if age == "now" else "f2"


def counts(s: Svg, xr, y, n, gap=6):
    """Right-aligned count chips: documents, terminals, kernels. xr = right edge."""
    x = xr
    for glyph, num in reversed(list(zip((g_tabs, g_terminal, g_kernel), n))):
        if num is None:
            continue
        tw = 7 * len(str(num))
        x -= tw
        s.text(x, y + 12, str(num), "f2", 11)
        x -= 15
        if glyph is g_kernel:
            s.raw(f'<circle cx="{x+7}" cy="{y+8}" r="4.5" style="fill:none;stroke:{v("f2")};stroke-width:1.1"/>')
        elif glyph is g_terminal:
            g_terminal(s, x, y, "f2")
        else:
            g_tabs(s, x, y)
        x -= gap


def panel_header(s: Svg, y, title="Workspaces", count="11", filter_on=False, hidden_on=False):
    s.rect(0, y, W, 30, v("l1"))
    s.line(0, y + 30, W, y + 30, v("b2"))
    s.runs(14, y + 19, [(title.upper(), "f1", 11, 600, False, 0), (count, "f2", 11, 400, False, 8)])
    icon_button(s, W - 82, y + 3, g_filter, active=filter_on)
    icon_button(s, W - 56, y + 3, g_eye, active=hidden_on)
    icon_button(s, W - 30, y + 3, g_refresh)
    return y + 31


def sub_header(s: Svg, x, y, label, n):
    s.runs(x, y + 15, [(label.upper(), "f2", 10, 600, False, 0), (str(n), "f2", 10, 400, False, 6)])
    return y + 22


def row(s: Svg, x, y, kind, label, detail, right, right_colour="f2", hover=False, dim=False, span=(4, W)):
    if hover:
        s.rect(span[0], y, span[1] - span[0], 24, v("l2"))
    if kind == "term":
        g_terminal(s, x, y + 4)
    elif kind == "kernel":
        g_kernel(s, x, y + 4, detail[1])
        detail = detail[0]
    else:
        g_file(s, x, y + 4, kind)
    s.runs(x + 22, y + 16, [(label, "f2" if dim else "f1", 12, 400, False, 0)] + ([(detail, "f2", 11, 400, False, 8)] if detail else []))
    s.text(W - 12, y + 16, right, right_colour, 11, anchor="end")
    return y + 24


def workspace_body(s: Svg, y, ws, x=26):
    y = sub_header(s, x, y + 2, "Tabs", len(ws["docs"]))
    for kind, name, folder in ws["docs"]:
        y = row(s, x, y, kind, name, folder, "")
    y = sub_header(s, x, y + 2, "Terminals", len(ws["terms"]))
    for i, (proc, name, age) in enumerate(ws["terms"]):
        y = row(s, x, y, "term", proc, f"terminal {name}", age, age_colour(age), hover=(i == 1))
    y = sub_header(s, x, y + 2, "Kernels", len(ws["kernels"]))
    for kname, nb, age, state in ws["kernels"]:
        y = row(s, x, y, "kernel", kname, (nb, state), age)
    return y + 4


# ---------- Alternative A: strip accordion ----------

def alt_a() -> Svg:
    s = Svg(W, 640, "Alternative A - accordion with colour strip")
    y = panel_header(s, 0)
    ws = DEFAULT_WS
    top = y
    # open section: header band, then body; the strip runs the full height
    s.rect(0, y, W, 44, v("l2"))
    g_caret(s, 8, y + 6)
    s.text(26, y + 18, ws["name"], "f0", 12, 600)
    s.rect(26 + 7.2 * len(ws["name"]) + 6, y + 7, 48, 15, "none", rx=2, stroke=v("brand1"))
    s.text(26 + 7.2 * len(ws["name"]) + 30, y + 18, "current", "brand1", 9, 600, anchor="middle")
    s.text(26, y + 35, ws["purpose"], "f2", 11, italic=True)
    s.text(W - 34, y + 18, ws["age"], age_colour(ws["age"]), 11, anchor="end")
    icon_button(s, W - 30, y + 3, g_dots)
    counts(s, W - 12, y + 24, (3, 5, 1))
    y = workspace_body(s, y + 44, ws)
    s.rect(0, top, 4, y - top, v(ws["colour"]))
    s.line(0, y, W, y, v("b3"))
    for o in OTHERS:
        h = 44
        hover = o["name"] == HOVER
        s.rect(0, y, W, h, v("l3") if hover else v("l2"))
        s.rect(0, y, 4, h, v(o["colour"]))
        g_caret(s, 8, y + 6, open_=False)
        s.text(26, y + 18, o["name"], "f1", 12, 600)
        s.text(W - 34, y + 18, o["age"], age_colour(o["age"]), 11, anchor="end")
        icon_button(s, W - 30, y + 3, g_dots, hover=hover)
        if hover:
            # hover reveals the two header actions of the brief
            icon_button(s, W - 104, y + 3, g_open, hover=True)
            icon_button(s, W - 80, y + 3, g_closeall, hover=True)
        if o["purpose"]:
            s.text(26, y + 35, o["purpose"], "f2", 11, italic=True)
        counts(s, W - 12, y + 24, o["n"])
        y += h
        s.line(0, y, W, y, v("b3"))
    # unassigned: no colour, dashed marker
    s.rect(0, y, W, 30, v("l2"))
    g_caret(s, 8, y + 6, open_=False)
    g_unassigned(s, 24, y + 7)
    s.text(44, y + 19, "In no workspace", "f1", 12, 600)
    counts(s, W - 12, y + 7, (None, 10, 0))
    y += 30
    s.line(0, y, W, y, v("b3"))
    s.rect(0, y, W, 30, v("l2"))
    g_caret(s, 8, y + 6, open_=False)
    s.text(26, y + 19, "Other sessions", "f1", 12, 600)
    s.text(W - 12, y + 19, "3 sections", "f2", 11, anchor="end")
    y += 30
    s.line(0, y, W, y, v("b3"))
    g_eye(s, 12, y + 8, colour="f2", off=True)
    s.text(34, y + 20, "3 hidden workspaces", "f2", 11, italic=True)
    s.h = y + 36
    return s


# ---------- Alternative B: tinted cards ----------

def card_header(s: Svg, x, y, w, ws, n, open_, hover=False):
    h = 44
    s.rect(x, y, w, h, tint(ws["colour"], 22 if open_ else 12), rx=3)
    s.rect(x, y, 3, h, v(ws["colour"]))
    s.text(x + 12, y + 18, ws["name"], "f0" if open_ else "f1", 12, 600)
    if ws["name"] == "default":
        s.raw(f'<circle cx="{x + 12 + 7.2 * len(ws["name"]) + 8}" cy="{y + 14}" r="3" style="fill:{v("brand1")}"/>')
    s.text(x + w - 30, y + 18, ws["age"], age_colour(ws["age"]), 11, anchor="end")
    icon_button(s, x + w - 27, y + 3, g_dots, hover=hover)
    if ws.get("purpose"):
        s.text(x + 12, y + 35, ws["purpose"], "f2", 11, italic=True)
    counts(s, x + w - 10, y + 24, n)
    return y + h


def alt_b() -> Svg:
    s = Svg(W, 640, "Alternative B - tinted cards")
    y = panel_header(s, 0)
    x, w = 8, W - 16
    y += 8
    ws = DEFAULT_WS
    top = y
    y = card_header(s, x, y, w, ws, (3, 5, 1), True)
    # card body
    body_top = y
    s.rect(x, body_top, w, 10, v("l1"))
    yy = body_top + 2
    for kind, name, folder in ws["docs"]:
        yy = row(s, x + 12, yy, kind, name, folder, "")
    s.line(x + 12, yy + 2, x + w - 8, yy + 2, v("b2"))
    yy += 4
    for i, (proc, name, age) in enumerate(ws["terms"]):
        yy = row(s, x + 12, yy, "term", proc, f"terminal {name}", age, age_colour(age), hover=(i == 1), span=(x + 3, x + w - 1))
    s.line(x + 12, yy + 2, x + w - 8, yy + 2, v("b2"))
    yy += 4
    for kname, nb, age, state in ws["kernels"]:
        yy = row(s, x + 12, yy, "kernel", kname, (nb, state), age)
    # footer actions
    yy += 4
    for bx, label, primary in ((x + 12, "Close all tabs", False),):
        s.rect(bx, yy, 104, 24, "none", rx=2, stroke=v("b2"))
        s.text(bx + 52, yy + 16, label, "f1", 11, anchor="middle")
    s.text(x + w - 10, yy + 16, "current workspace", "brand1", 11, anchor="end")
    yy += 32
    s.rect(x, top, w, yy - top, "none", rx=3, stroke=tint(ws["colour"], 60))
    s.rect(x, top, 3, yy - top, v(ws["colour"]))
    y = yy + 6
    for o in OTHERS:
        y = card_header(s, x, y, w, o, o["n"], False, hover=(o["name"] == HOVER)) + 6
    # unassigned card
    s.rect(x, y, w, 30, "none", rx=3, stroke=v("b2"), dash="3 2")
    g_unassigned(s, x + 10, y + 7)
    s.text(x + 32, y + 19, "In no workspace", "f1", 12, 600)
    counts(s, x + w - 10, y + 7, (None, 10, 0))
    y += 36
    s.rect(x, y, w, 30, v("l2"), rx=3)
    s.text(x + 12, y + 19, "Other sessions", "f1", 12, 600)
    s.text(x + w - 10, y + 19, "3 sections", "f2", 11, anchor="end")
    y += 36
    g_eye(s, 12, y + 2, colour="f2", off=True)
    s.text(34, y + 14, "3 hidden workspaces", "f2", 11, italic=True)
    s.h = y + 28
    return s


# ---------- Alternative C: colour rail ----------

def alt_c() -> Svg:
    s = Svg(W, 560, "Alternative C - colour rail with one open workspace")
    y = panel_header(s, 0)
    rail = 44
    ws_all = [DEFAULT_WS] + OTHERS
    ry = y + 6
    for i, o in enumerate(ws_all):
        sel = i == 0
        initials = "".join(p[0] for p in o["name"].replace("_", "-").split("-")[:2]).upper()
        if sel:
            s.rect(4, ry, rail - 4, 44, v("l1"))
            s.rect(4, ry, 4, 44, v(o["colour"]))
        else:
            s.rect(8, ry + 4, 30, 36, tint(o["colour"], 30, "l0"), rx=3)
            s.rect(8, ry + 4, 3, 36, v(o["colour"]))
        s.text(rail / 2 + 3, ry + 27, initials, "f0" if sel else "f1", 11, 600, anchor="middle")
        if i == 0:
            s.raw(f'<circle cx="{rail - 9}" cy="{ry + 9}" r="2.6" style="fill:{v("brand1")}"/>')
        ry += 48
    # unassigned and hidden at the foot of the rail
    s.rect(8, ry + 4, 30, 30, "none", rx=3, stroke=v("f2"), dash="3 2")
    g_unassigned(s, 15, ry + 11)
    ry += 40
    g_eye(s, 15, ry + 6, colour="f2", off=True)
    s.text(rail / 2, ry + 36, "3", "f2", 10, anchor="middle")
    # content pane
    x0 = rail + 10
    ws = DEFAULT_WS
    s.text(x0, y + 22, ws["name"], "f0", 14, 600)
    s.rect(x0 + 8.4 * len(ws["name"]) + 6, y + 10, 48, 15, "none", rx=2, stroke=v("brand1"))
    s.text(x0 + 8.4 * len(ws["name"]) + 30, y + 21, "current", "brand1", 9, 600, anchor="middle")
    icon_button(s, W - 30, y + 6, g_dots)
    s.text(x0, y + 40, ws["purpose"], "f2", 11, italic=True)
    s.text(x0, y + 58, "used now", "brand1", 11)
    counts(s, W - 12, y + 46, (3, 5, 1))
    bx = x0
    for label, wdt in (("Open", 50), ("Close all tabs", 100)):
        s.rect(bx, y + 68, wdt, 24, "none", rx=2, stroke=v("b2"))
        s.text(bx + wdt / 2, y + 84, label, "f2" if label == "Open" else "f1", 11, anchor="middle")
        bx += wdt + 6
    s.line(rail, y + 100, W, y + 100, v("b2"))
    yy = y + 102
    sub_x = x0
    yy = sub_header(s, sub_x, yy, "Tabs", 3)
    for kind, name, folder in ws["docs"]:
        yy = row_c(s, sub_x, yy, kind, name, "")
    yy = sub_header(s, sub_x, yy + 2, "Terminals", 5)
    for i, (proc, name, age) in enumerate(ws["terms"]):
        yy = row_c(s, sub_x, yy, "term", f"{proc}  {name}", age, age_colour(age))
    yy = sub_header(s, sub_x, yy + 2, "Kernels", 1)
    yy = row_c(s, sub_x, yy, "kernel", "Python 3", "5m", state="ok")
    s.h = max(yy + 8, ry + 50)
    s.parts.insert(0, f'<rect x="0" y="31" width="{rail}" height="{s.h - 31}" style="fill:{v("l0")}"/>')
    return s


def row_c(s: Svg, x, y, kind, label, right, right_colour="f2", state="ok"):
    if kind == "term":
        g_terminal(s, x, y + 4)
    elif kind == "kernel":
        g_kernel(s, x, y + 4, state)
    else:
        g_file(s, x, y + 4, kind)
    s.text(x + 22, y + 16, label, "f1", 12)
    s.text(W - 12, y + 16, right, right_colour, 11, anchor="end")
    return y + 24


# ---------- Design B on the design system (aligned by the Star Colonel on 2026-10-28) ----------

# Font sizes of Galaxa Dark Theme - Steel: --jp-ui-font-size1 is 11px, size2 1.2em of it,
# size0 0.8333em. Colour roles (DQ-07): primary text f1, meta text, counts, carets and empty
# states f2; the recent emphasis brand1; destructive entries err.
FS0, FS1, FS2 = 9.2, 11, 13.2
G = 12  # the scrollbar gutter every section list reserves (DQ-05)
LW = W - G  # width of a section list
TAB_PATH = "M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 16H3V5h10v4h8z"
KERNEL_PATH = (
    "M15 9H9v6h6zm-2 4h-2v-2h2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2"
    "c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2zm-4 6H7V7h10z"
)

# Each workspace colour is a theme token (DQ-01); the menu names the hue the token shows
WS_TOKEN = {"rose": "err", "peach": "warn1", "lemon": "warn2", "mint": "ok", "sky": "brand1", "lavender": "info1"}
TOKEN_NAME = {"err": "--jp-error-color1", "warn1": "--jp-warn-color1", "warn2": "--jp-warn-color2",
              "ok": "--jp-success-color1", "brand1": "--jp-brand-color1", "info1": "--jp-info-color1"}
WS_LABEL = {"rose": "Red", "peach": "Orange", "lemon": "Amber", "mint": "Green", "sky": "Blue", "lavender": "Cyan"}
ROTATION = ["sky", "lavender", "rose", "peach", "lemon", "mint"]
STATE = {"idle": "ok", "busy": "brand2", "starting": "l4"}  # kernel state dot (DQ-13)


def ws_colour(colour: str) -> str:
    return v(WS_TOKEN[colour])


def fit(s: str, px: float, per: float) -> str:
    """Cut s to px at per pixels a character and end it in an ellipsis, as text-overflow does."""
    n = int(px // per)
    return s if len(s) <= n else s[: max(n - 1, 1)].rstrip() + "…"


def g_tab(s: Svg, x, y, colour="glyph", size=16):
    """JupyterLab's own tabIcon (ui-components sidebar/tab.svg)."""
    s.raw(f'<path transform="translate({x},{y}) scale({size / 24})" d="{TAB_PATH}" style="fill:{v(colour)}"/>')


def g_kern(s: Svg, x, y, colour="glyph", size=16):
    """JupyterLab's own kernelIcon (ui-components statusbar/kernel.svg)."""
    s.raw(f'<path transform="translate({x},{y}) scale({size / 24})" d="{KERNEL_PATH}" style="fill:{v(colour)}"/>')


def g_arrow(s: Svg, x, y, colour="glyph", up=True):
    d = f"M{x+8} {y+13}V{y+3}M{x+4} {y+7}l4-4 4 4" if up else f"M{x+8} {y+3}v10M{x+4} {y+9}l4 4 4-4"
    s.raw(f'<path d="{d}" style="fill:none;stroke:{v(colour)};stroke-width:1.2;stroke-linejoin:round"/>')


def g_warn(s: Svg, x, y, colour="err"):
    s.raw(f'<path d="M{x+8} {y+2}l6.5 11.5h-13z" style="fill:none;stroke:{v(colour)};stroke-width:1.2;stroke-linejoin:round"/>')
    s.raw(f'<path d="M{x+8} {y+6.5}v3.5M{x+8} {y+11.3}v.8" style="fill:none;stroke:{v(colour)};stroke-width:1.3"/>')


def dot(s: Svg, cx, cy, colour, r=4):
    s.raw(f'<circle cx="{cx}" cy="{cy}" r="{r}" style="fill:{v(colour)}"/>')


def grouped(s: Svg, idx: int, style: str) -> None:
    s.parts[idx:] = [f'<g style="{style}">' + "".join(s.parts[idx:]) + "</g>"]


def button(s: Svg, x, y, glyph, active=False, hover=False, disabled=False, **kw):
    """A 24x24 header button with a 14px glyph (DQ-16): inactive glyph inverse layout 3, hover and
    active on layout 3, active glyph brand 1; a disabled one keeps its place at opacity 0.4 (DQ-12)."""
    if (active or hover) and not disabled:
        s.rect(x, y, 24, 24, v("l3"), rx=2)
    idx = len(s.parts)
    glyph(s, 0, 0, colour="brand1" if active else ("f1" if hover else "glyph"), **kw)
    op = ' opacity="0.4"' if disabled else ""
    s.parts[idx:] = [f'<g transform="translate({x + 5},{y + 5}) scale(0.875)"{op}>' + "".join(s.parts[idx:]) + "</g>"]


def panel_band(s: Svg, y, filter_on=False, hidden_on=False):
    """DQ-06: a 28px band on layout 2, the title on the column of the section labels."""
    s.rect(0, y, W, 28, v("l2"))
    s.text(18, y + 17.5, "WORKBENCH", "f1", FS0, 600, spacing=1)
    for k, (glyph, on) in enumerate(((g_plus, False), (g_filter, filter_on), (g_eye, hidden_on), (g_refresh, False))):
        button(s, W - 100 + 24 * k, y + 2, glyph, active=on)
    return y + 28


def section_head(s: Svg, y, label, n, shutdown=None, open_=True):
    """DQ-03: a band on layout 2, caret on the 4px inset, label at 18px, count in colour 2 6px
    after it; Shut down all on the three lower sections, disabled while the section is empty."""
    s.line(0, y - 0.5, W, y - 0.5, v("b3"))
    s.rect(0, y, W, 24, v("l2"))
    g_caret(s, 3, y + 4, open_=open_, colour="f2")
    s.text(18, y + 15.5, label, "f1", FS0, 600, spacing=1)
    s.text(18 + len(label) * 8 + 6, y + 15.5, f"({n})", "f2", FS0)
    if shutdown is not None:
        idx, bw = len(s.parts), 74
        s.rect(W - 8 - bw, y + 3, bw, 18, v("l1"), rx=2, stroke=v("b1"))
        s.text(W - 8 - bw / 2, y + 15, "Shut down all", "f1", FS0, anchor="middle")
        if not shutdown:
            grouped(s, idx, "opacity:0.4")
    return y + 24


def thumb(s: Svg, top, h, start, length):
    """The scrollbar of a section's own list (DQ-05), in its reserved gutter."""
    s.rect(LW + 3, top + 2 + (h - 4) * start, 6, (h - 4) * length, v("l4"), rx=3)


def empty(s: Svg, y, text):
    """DQ-08: an empty state is italic colour 2 at size 0."""
    s.text(18, y + 15, text, "f2", FS0, italic=True)
    return y + 24


def b_counts(s: Svg, xr, y, n):
    """Tabs, terminals, kernels, right-aligned at xr: glyphs inverse layout 3, numbers colour 2."""
    x = xr
    for glyph, num in reversed(list(zip(("tab", "term", "kern"), n))):
        x -= 6.2 * len(str(num))
        s.text(x, y + 12, str(num), "f2", FS1)
        x -= 18
        {"tab": lambda: g_tab(s, x, y), "term": lambda: g_terminal(s, x, y), "kern": lambda: g_kern(s, x, y)}[glyph]()
        x -= 8


def b_row(s: Svg, x, y, w, kind, name, time=None, state=None, selected=False, hover=False, detail=None, mono=False):
    """DQ-17 row: type icon, name, the state dot and its word (DQ-13), the time; the detail line
    shows only on the selected row. Hover and selection paint layout 2 (DQ-10). Identifiers in
    the code font (DQ-18). detail: [(text, mono), ...]."""
    h = 24 + (18 if selected and detail else 0)
    if hover or selected:
        s.rect(x, y, w, h, v("l2"))
    gx = x + 13
    if kind == "term":
        g_terminal(s, gx, y + 4)
    elif kind == "kern":
        g_kern(s, gx, y + 4)
    else:
        g_file(s, gx, y + 4, kind)
    recent = time == "now"
    right = x + w - 8
    if time:
        s.text(right, y + 16, time, "brand1" if recent else "f2", FS1, anchor="end")
        right -= 6.2 * len(time) + 12
    if state:
        s.text(right, y + 16, state, "f2", FS1, anchor="end")
        right -= 6.2 * len(state) + 10
        dot(s, right, y + 12, STATE[state])
        right -= 10
    nx = gx + 22
    s.text(nx, y + 16, fit(name, right - nx - 4, 6.6 if mono else 6.2), "brand1" if recent else "f1", FS1, mono=mono)
    if selected and detail:
        dx = nx
        for text, code in detail:
            s.text(dx, y + 35, text, "f2", FS1, mono=code)
            dx += len(text) * (6.6 if code else 6.2) + 8
    return y + h


def frame(s: Svg, idx, x, top, w, header_bottom, bottom, ws, current):
    """DQ-02 card under the content drawn since parts[idx]: one shape with 2px corners that clips
    the header (layout 2), the body (layout 1), the 1px border 1 and the 4px strip in the
    workspace's token (the card's left border); this window's 2px brand 2 outline lies against it."""
    h, hh = bottom - top, header_bottom - top
    cid = s.uid("card")
    sq = lambda rx, ry, rw, rh, fill: (
        f'<rect x="{rx}" y="{ry}" width="{rw}" height="{rh}" style="fill:{fill}"/>' if rh > 0 else "")
    s.parts.insert(idx, "".join([
        f'<clipPath id="{cid}"><rect x="{x}" y="{top}" width="{w}" height="{h}" rx="2"/></clipPath>',
        f'<g clip-path="url(#{cid})">',
        sq(x, top, w, hh, v("l2")), sq(x, header_bottom, w, h - hh, v("l1")),
        f'<rect x="{x + .5}" y="{top + .5}" width="{w - 1}" height="{h - 1}" rx="1.5" style="fill:none;stroke:{v("b1")}"/>',
        sq(x, top, 4, h, ws_colour(ws["colour"])), "</g>"]))
    if current:
        s.rect(x - 1, top - 1, w + 2, h + 2, "none", rx=3, stroke=v("brand2"), sw=2)


def card(s: Svg, x, y, w, ws, open_=False, current=False, hidden=False, hover=None, groups=None, of=None):
    """Header: triangle, name, time, then Open workspace, Close all tabs, the eye and ... in the same
    place on every card (DQ-12); purpose and counts only while open (DQ-17); recent and stale
    emphasis (DQ-09)."""
    top, idx = y, len(s.parts)
    age = ws["age"]
    recent = age == "now"
    stale = age.endswith("d ago") and int(age.split("d")[0]) > 7
    g_caret(s, x + 7, y + 6, open_=open_, colour="f2")
    bx = x + w - 2 - 96
    tx = bx - 6
    word = "hidden" if hidden else age
    s.text(tx, y + 18, word, "brand1" if recent and not hidden else "f2", FS1, anchor="end")
    name = fit(ws["name"], tx - 6.2 * len(word) - 8 - (x + 26), 7.6)
    s.text(x + 26, y + 18.5, name, "brand1" if recent else "f1", FS2, 600, opacity=0.65 if stale else None)
    for k, (glyph, kw, disabled) in enumerate((
            (g_go, {}, current), (g_closeall, {}, False),
            (g_eye, {"off": not hidden}, current), (g_dots, {}, hidden))):
        button(s, bx + 24 * k, y + 2, glyph, hover=(hover == k), active=(hidden and glyph is g_eye),
               disabled=disabled, **kw)
    y += 28
    if open_:
        lines = wrap(ws.get("purpose", ""), 24) if ws.get("purpose") else []
        if of:
            s.text(x + w - 8, y + 9, of, "f2", FS1, anchor="end")
        else:
            b_counts(s, x + w - 8, y - 3, ws["n"])
        for k, line in enumerate(lines):
            s.text(x + 26, y + 9 + 15 * k, line, "f1", FS1)
        y += max(1, len(lines)) * 15 + 4
    hb = y
    if open_ and groups:
        y += 4
        for label, rows in groups:
            s.text(x + 18, y + 13, label.upper(), "f1", FS0, 600, spacing=1)
            s.text(x + 18 + len(label) * 8 + 6, y + 13, f"({len(rows)})", "f2", FS0)
            y += 19
            for r in rows:
                # rows start after the strip, the card's 4px left border
                y = b_row(s, x + 4, y, w - 5, **r)
            y += 3
        y += 3
    frame(s, idx, x, top, w, hb, y, ws, current)
    return y


DEFAULT_B = {"name": "default", "colour": "sky", "purpose": "Extension development", "age": "2m ago", "n": (3, 5, 1)}
B2_OTHERS = [
    {"name": "iconprobe2", "colour": "mint", "purpose": "", "age": "now", "n": (1, 0, 0)},
    {"name": "auto-6", "colour": "peach", "purpose": "Firmware upload tests", "age": "3d ago", "n": (0, 1, 0)},
    {"name": "wf-regression-hist-1", "colour": "lemon", "purpose": "Regression history workflow", "age": "3d ago", "n": (2, 0, 1)},
    {"name": "scratch", "colour": "rose", "purpose": "", "age": "1h ago", "n": (0, 0, 0)},
    {"name": "fb-exp-panels-base", "colour": "lavender", "purpose": "", "age": "9d ago", "n": (0, 0, 0)},
]
TERMS = [("7", "now", "claude"), ("11", "2m ago", "claude"), ("13", "3h ago", "fish"),
         ("14", "12m ago", "claude"), ("15", "1d ago", "fish")]


def term_row(n, time, proc, **kw):
    return dict(kind="term", name=f"terminal {n}", time=time, mono=True, detail=[(proc, False)], **kw)


def workspaces(s: Svg, y, cards, n=None, hidden_line=3):
    """The WORKSPACES section: cards in its own scroll container, then the hidden count line."""
    y = section_head(s, y, "WORKSPACES", n if n is not None else len(cards)) + 6
    for args in cards:
        y = card(s, 8, y, LW - 16, **args) + 6
    if hidden_line:
        g_eye(s, 12, y, colour="glyph", off=True)
        s.text(34, y + 12, f"{hidden_line} hidden workspaces", "f2", FS1)
        y += 22
    return y


def b2_closed() -> Svg:
    s = Svg(W, 600, "Design B on the design system - load state: every section open, no card open")
    y = panel_band(s, 0)
    y = workspaces(s, y, [dict(ws=DEFAULT_B, current=True)] +
                   [dict(ws=o, hover=(1 if o["name"] == HOVER else None)) for o in B2_OTHERS])
    return lower_sections(s, y)


def lower_sections(s: Svg, y) -> Svg:
    """KERNELS, TERMINALS (its own scroll bar) and LANGUAGE SERVERS, which a filter does not narrow."""
    y = section_head(s, y, "KERNELS", 2, shutdown=True)
    y = b_row(s, 0, y, LW, "kern", "design.ipynb", "5m ago", "idle")
    y = b_row(s, 0, y, LW, "kern", "history.ipynb", "now", "busy")
    y = section_head(s, y, "TERMINALS", 10, shutdown=True)
    top = y
    for n, time, proc in TERMS:
        y = b_row(s, 0, y, LW, **term_row(n, time, proc))
    thumb(s, top, y - top, 0, 0.5)
    y = section_head(s, y, "LANGUAGE SERVERS", 0, shutdown=False)
    s.h = empty(s, y, "No language servers") + 4
    return s


def b2_open() -> Svg:
    s = Svg(W, 720, "Design B on the design system - this window's card open, a KERNELS row selected (the panel's one selected row)")
    y = panel_band(s, 0)
    groups = [
        ("Tabs", [dict(kind="md", name="README.md", detail=[("docs/", True)]),
                  dict(kind="md", name="brief.md", detail=[("docs/", True)]),
                  dict(kind="nb", name="design.ipynb", detail=[("notebooks/", True)])]),
        ("Terminals", [term_row(n, t, p) for n, t, p in TERMS]),
        ("Kernels", [dict(kind="kern", name="design.ipynb", time="5m ago", state="idle",
                          detail=[("Python 3 (ipykernel)", False)])]),
    ]
    y = workspaces(s, y, [dict(ws=DEFAULT_B, current=True, open_=True, groups=groups)] +
                   [dict(ws=o) for o in B2_OTHERS[:2]], n=6, hidden_line=0)
    y = section_head(s, y, "KERNELS", 2, shutdown=True)
    y = b_row(s, 0, y, LW, "kern", "design.ipynb", "5m ago", "idle")
    # KERN-02: the file name shows whole; the kernel type and the folder give way first
    y = b_row(s, 0, y, LW, "kern", "history.ipynb", "now", "busy", selected=True,
            detail=[("Python…", False), ("…/history.ipynb", True), ("182 MB", False), ("3%", False)])
    y = section_head(s, y, "TERMINALS", 10, shutdown=True)
    s.h = y + 4
    return s


def b2_filter() -> Svg:
    s = Svg(W, 560, "Design B on the design system - filter claude: it narrows the workspace cards; KERNELS, TERMINALS and LANGUAGE SERVERS keep every row")
    y = panel_band(s, 0, filter_on=True)
    s.rect(8, y + 6, W - 16, 24, "color-mix(in srgb, #000 4%, var(--m-l1))", rx=2, stroke=v("brand1"))
    g_filter(s, 13, y + 10, colour="f2")
    s.text(34, y + 22, "claude", "f1", FS1)
    s.text(W - 20, y + 22, "x", "f2", FS1 + 1, anchor="middle")
    y += 36
    matches = [
        dict(ws=DEFAULT_B, current=True, open_=True, of="(3 of 9)",
             groups=[("Terminals", [term_row(n, t, p) for n, t, p in TERMS if p == "claude"])]),
        dict(ws=B2_OTHERS[1], open_=True, of="(1 of 1)", groups=[("Terminals", [term_row("1", "1d ago", "claude")])]),
    ]
    y = workspaces(s, y, matches, hidden_line=0)
    s.text(18, y + 10, "4 workspaces without a match are not shown", "f2", FS1)
    # src/panel/panel.tsx _render applies the filter to the workspace cards only
    return lower_sections(s, y + 20)


def b2_menu() -> Svg:
    s = Svg(W + 116, 380, "Design B on the design system - workspace menu with the Colour submenu")
    # the submenu reaches past the sidebar into the main area
    s.rect(W, 0, 116, 400, v("l0"))
    s.line(W, 0, W, 400, v("b2"))
    y = panel_band(s, 0)
    y = section_head(s, y, "WORKSPACES", 6) + 6
    x, w = 8, LW - 16
    top = y
    y = card(s, x, y, w, B2_OTHERS[1])
    button(s, x + w - 2 - 24, top + 2, g_dots, active=True)
    my, mx, mw = y + 2, 104, 192
    colour = B2_OTHERS[1]["colour"]
    items = [
        ("Open workspace", lambda gx, gy: g_go(s, gx, gy, "glyph"), None),
        ("Open in new browser tab", lambda gx, gy: g_open(s, gx, gy, "glyph"), None),
        ("Close all tabs", lambda gx, gy: g_closeall(s, gx, gy, "glyph"), None), None,
        ("Set description...", lambda gx, gy: g_pencil(s, gx, gy, "glyph"), None),
        ("Colour", lambda gx, gy: s.rect(gx + 2, gy + 2, 12, 12, ws_colour(colour), rx=2, stroke=v("l4")), ">"),
        ("Hide workspace", lambda gx, gy: g_eye(s, gx, gy, "glyph", off=True), None),
        ("Move up", lambda gx, gy: g_arrow(s, gx, gy, "glyph"), None),
        ("Move down", lambda gx, gy: g_arrow(s, gx, gy, "glyph", up=False), None), None,
        # DQ-11: a destructive entry draws label and icon in the error colour, at rest and selected
        ("Delete workspace", lambda gx, gy: g_bin(s, gx, gy, "err"), "danger"),
    ]
    h = sum(8 if it is None else 24 for it in items) + 8
    s.rect(mx + 2, my + 3, mw, h, "rgba(0,0,0,.25)", rx=2)
    s.rect(mx, my, mw, h, v("l1"), rx=2, stroke=v("l3"))
    iy, sub_y = my + 4, my
    for it in items:
        if it is None:
            s.line(mx + 8, iy + 4, mx + mw - 8, iy + 4, v("l3"))
            iy += 8
            continue
        label, glyph, mod = it
        if mod == ">":
            s.rect(mx + 1, iy, mw - 2, 24, v("l2"))
            s.text(mx + mw - 12, iy + 16, ">", "f1", FS1, anchor="end")
            sub_y = iy
        glyph(mx + 8, iy + 4)
        s.text(mx + 32, iy + 16, label, "err" if mod == "danger" else "f1", FS1 + 1)
        iy += 24
    names = ROTATION[2:] + ROTATION[:2]  # Red, Orange, Amber, Green, Blue, Cyan
    sx, sy, sw = mx + mw - 2, sub_y - 4, 112
    sh = len(names) * 24 + 8
    s.rect(sx + 2, sy + 3, sw, sh, "rgba(0,0,0,.25)", rx=2)
    s.rect(sx, sy, sw, sh, v("l1"), rx=2, stroke=v("l3"))
    for k, cid in enumerate(names):
        s.rect(sx + 10, sy + 4 + k * 24 + 6, 12, 12, ws_colour(cid), rx=2, stroke=v("l4"))
        s.text(sx + 32, sy + 4 + k * 24 + 16, WS_LABEL[cid], "f1", FS1 + 1)
        if cid == colour:
            s.text(sx + sw - 10, sy + 4 + k * 24 + 16, "✓", "f1", FS1 + 1, anchor="end")
    s.h = max(my + h, sy + sh) + 12
    return s


def b2_hidden() -> Svg:
    s = Svg(W, 330, "Design B on the design system - hidden workspaces shown")
    y = panel_band(s, 0, hidden_on=True)
    hidden = [{"name": "iconprobe", "colour": "rose", "age": "2d ago"},
              {"name": "fb-exp-rename-base", "colour": "mint", "age": "1d ago"},
              {"name": "fb-exp-simcheck", "colour": "lemon", "age": "1d ago"}]
    y = workspaces(s, y, [dict(ws=DEFAULT_B, current=True), dict(ws=B2_OTHERS[1])] +
                   [dict(ws=h, hidden=True) for h in hidden], hidden_line=0)
    s.text(18, y + 10, "The eye of a shown card hides it;", "f2", FS1)
    s.text(18, y + 26, "the eye of a hidden card shows it again", "f2", FS1)
    s.h = y + 38
    return s


def footer_button(s: Svg, x, y, w, label, kind, disabled=False):
    """dialog-controls recipe: primary filled brand 1 (the only fill); secondary a surface button,
    border 2; danger unfilled with error-coloured text and border (DQ-14)."""
    idx = len(s.parts)
    if kind == "primary":
        s.rect(x, y, w, 26, v("brand1"), rx=2)
        s.text(x + w / 2, y + 17, label, "inv0", FS1 + 1, 600, anchor="middle")
    elif kind == "danger":
        s.rect(x + .5, y + .5, w - 1, 25, "none", rx=2, stroke=f"color-mix(in srgb, {v('err')} 60%, {v('b2')})")
        s.text(x + w / 2, y + 17, label, "err", FS1 + 1, anchor="middle")
    else:
        s.rect(x + .5, y + .5, w - 1, 25, f"color-mix(in srgb, {v('l1')} 92%, {v('f0')})", rx=2, stroke=v("b2"))
        s.text(x + w / 2, y + 17, label, "f0", FS1 + 1, anchor="middle")
    if disabled:
        grouped(s, idx, "opacity:0.4")


def b2_new() -> Svg:
    """The dialog of the + button: filled in, and a name that exists."""
    s = Svg(560, 290, "Design B on the design system - New workspace dialog")
    field = "color-mix(in srgb, #000 4%, var(--m-l1))"
    states = [
        ("fb-review", "Review of the feedback runs before\nthe release of the new grader", None),
        ("auto-6", "", "A workspace named auto-6 exists"),
    ]
    for i, (name, purpose, error) in enumerate(states):
        x, y, w = 8 + i * 276, 8, 268
        s.rect(x + 2, y + 3, w, 272, "rgba(0,0,0,.25)", rx=2)
        s.rect(x, y, w, 272, v("l1"), rx=2, stroke=v("l3"))
        s.text(x + 16, y + 28, "New workspace", "f1", FS2, 600)
        s.text(x + 16, y + 54, "Name", "f1", FS1)
        s.rect(x + 16, y + 60, w - 32, 26, field, rx=2, stroke=v("brand1"))
        s.text(x + 24, y + 77, name, "f1", FS1 + 1)
        if error:
            # DQ-15: a state line - padding 6px 12px on layout 2, a 2px left border in the state colour
            s.rect(x + 16, y + 92, w - 32, 24, v("l2"))
            s.rect(x + 16, y + 92, 2, 24, v("err"))
            s.text(x + 28, y + 108, error, "f1", FS1)
        else:
            s.text(x + 16, y + 106, "Letters, digits, - and _", "f2", FS1)
        s.text(x + 16, y + 140, "Short description (optional)", "f1", FS1)
        s.rect(x + 16, y + 146, w - 32, 58, field, rx=2, stroke=v("b2"))
        for k, line in enumerate(purpose.split("\n") if purpose else []):
            s.text(x + 24, y + 163 + k * 16, line, "f1", FS1 + 1)
        s.text(x + w - 16, y + 220, f"{len(purpose.replace(chr(10), ' '))}/100", "f2", FS1, anchor="end")
        footer_button(s, x + w - 16 - 64, y + 234, 64, "Create", "primary", disabled=bool(error))
        footer_button(s, x + w - 16 - 136, y + 234, 64, "Cancel", "secondary")
    return s


def b2_shutdown() -> Svg:
    """DQ-14 and DQ-15: a shutdown question with no filled button, and the panel's banner."""
    s = Svg(560, 190, "Design B on the design system - shutdown dialog and the failed-reload banner")
    x, y, w = 8, 8, 268
    s.rect(x + 2, y + 3, w, 150, "rgba(0,0,0,.25)", rx=2)
    s.rect(x, y, w, 150, v("l1"), rx=2, stroke=v("l3"))
    s.text(x + 16, y + 28, "Shut down terminal 7?", "f1", FS2, 600)
    s.text(x + 16, y + 58, "Workspace auto-6 also holds this terminal.", "f1", FS1)
    footer_button(s, x + 16, y + 110, 84, "Shut down", "danger")
    footer_button(s, x + w - 16 - 64, y + 110, 64, "Cancel", "secondary")
    px = 288
    s.rect(px, 8, 264, 174, v("l1"))
    panel_band_y = 8
    s.rect(px, panel_band_y, 264, 28, v("l2"))
    s.text(px + 18, panel_band_y + 17.5, "WORKBENCH", "f1", FS0, 600, spacing=1)
    by = panel_band_y + 34
    s.rect(px + 8, by, 248, 26, f"color-mix(in srgb, {v('err')} 15%, transparent)", rx=2,
           stroke=f"color-mix(in srgb, {v('err')} 35%, transparent)")
    s.text(px + 16, by + 17, "Reload failed: terminals answered 500", "f1", FS1)
    s.line(px, by + 34.5, px + 264, by + 34.5, v("b3"))
    s.rect(px, by + 35, 264, 24, v("l2"))
    g_caret(s, px + 3, by + 39, colour="f2")
    s.text(px + 18, by + 50.5, "WORKSPACES", "f1", FS0, 600, spacing=1)
    s.text(px + 18 + 10 * 8 + 6, by + 50.5, "(6)", "f2", FS0)
    s.text(px + 16, by + 90, "The last content stays under the banner", "f2", FS1)
    return s


def b2_legend() -> Svg:
    s = Svg(560, 150, "Icons and marks of design B on the design system")
    items = [
        ("tab", "Tab count", "tabIcon"), ("term", "Terminal", "own glyph"),
        ("kern", "Kernel / notebook", "kernelIcon"),
    ]
    x = 12
    for kind, name, src in items:
        s.rect(x, 10, 170, 44, v("l2"), rx=2)
        {"tab": lambda: g_tab(s, x + 12, 24, "f1"), "term": lambda: g_terminal(s, x + 12, 24, "f1"),
         "kern": lambda: g_kern(s, x + 12, 24, "f1")}[kind]()
        s.text(x + 38, 30, name, "f1", FS1 + 1, 600)
        s.text(x + 38, 45, src, "f2", FS1)
        x += 180
    x = 12
    # DQ-13: the dot always has its word
    for state, label in (("idle", "idle"), ("busy", "busy"), ("starting", "starting, restarting, dead, unknown")):
        dot(s, x + 6, 74, STATE[state])
        s.text(x + 16, 78, label, "f1", FS1)
        x += {"idle": 60, "busy": 64}.get(state, 0)
    s.text(12, 104, "now", "brand1", FS1)
    s.text(40, 104, "under 60 s: name and time brand 1", "f2", FS1)
    s.text(270, 104, "fb-exp-panels-base", "f1", FS1, 600, opacity=0.65)
    s.text(392, 104, "over 7 days: name at 0.65", "f2", FS1)
    g_caret(s, 12, 120, open_=False, colour="f2")
    g_caret(s, 28, 120, open_=True, colour="f2")
    s.text(50, 133, "closed / open; triangle toggles, header switches", "f1", FS1)
    frame(s, len(s.parts), 330, 118, 40, 138, 138, {"colour": "sky"}, True)
    s.text(380, 133, "this window's workspace", "f1", FS1)
    return s


# ---------- palette and icons ----------

def palette() -> Svg:
    """DQ-01: each workspace colour is a theme token; the menu names its hue."""
    s = Svg(560, 156, "Workspace colours as theme tokens, in rotation order")
    for i, n in enumerate(ROTATION):
        x, y = 12 + (i % 3) * 182, 12 + (i // 3) * 66
        s.rect(x, y, 174, 56, v("l2"), rx=2)
        s.rect(x, y, 4, 56, ws_colour(n))
        s.rect(x + 14, y + 10, 12, 12, ws_colour(n), rx=2, stroke=v("l4"))
        s.text(x + 34, y + 21, f"{i + 1}. {WS_LABEL[n]}", "f1", FS1, 600)
        s.text(x + 104, y + 21, n, "f2", FS1, mono=True)
        s.text(x + 14, y + 44, TOKEN_NAME[WS_TOKEN[n]], "f2", FS1, mono=True)
    s.text(12, 148, "Order of rotation: 1 to 6, then 1 again. The theme sets each value; a theme flip repaints them.", "f1", FS1)
    return s


ICONS = {
    "stack": '<path d="M12 3 21 7.5 12 12 3 7.5z"/><path d="M3 12 12 16.5 21 12" style="fill:none"/><path d="M3 16.5 12 21 21 16.5" style="fill:none"/>',
    "strip": '<rect x="3" y="4" width="18" height="16" rx="2" style="fill:none"/><rect x="3" y="4" width="4.5" height="16" rx="1"/><path d="M10 9h8M10 13h8M10 17h5" style="fill:none"/>',
    "accordion": '<rect x="3" y="3" width="18" height="4" rx="1"/><rect x="3" y="9" width="18" height="8" rx="1" style="fill:none"/><rect x="3" y="9" width="3" height="8" rx="1"/><rect x="3" y="19" width="18" height="2.5" rx="1"/>',
    "panes": '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5" style="fill:none"/><rect x="3" y="13" width="8" height="8" rx="1.5" style="fill:none"/><rect x="13" y="13" width="8" height="8" rx="1.5" style="fill:none"/>',
}
ICON_NAMES = {
    "stack": "1. Layers",
    "strip": "2. Strip window",
    "accordion": "3. Accordion",
    "panes": "4. Panes",
}


def open_icon_sheet() -> Svg:
    s = Svg(560, 112, "Candidates for the Open workspace icon")
    for i, (label, glyph) in enumerate(OPEN_ICONS):
        x = 12 + i * 136
        s.rect(x, 10, 124, 92, v("l2"), rx=2)
        # as a hover button beside close-all-tabs, at real size
        icon_button(s, x + 8, 22, glyph, hover=True)
        icon_button(s, x + 32, 22, g_closeall, hover=True)
        # enlarged three times for reading
        idx = len(s.parts)
        glyph(s, 0, 0, colour="f0")
        s.parts[idx:] = [f'<g transform="translate({x + 68},{14}) scale(3)">' + "".join(s.parts[idx:]) + "</g>"]
        s.text(x + 62, 90, label, "f0", FS1, anchor="middle")
    return s


def icon_sheet() -> Svg:
    s = Svg(560, 150, "Sidebar icon candidates")
    for i, (key, body) in enumerate(ICONS.items()):
        x = 12 + i * 136
        s.rect(x, 10, 124, 100, v("l2"), rx=2)
        # sidebar tab at real size (16px) and the glyph at 48px for reading
        for size, gx, gy in ((16, x + 14, 22), (48, x + 54, 22)):
            sc = size / 24
            s.add(
                f'<g transform="translate({gx},{gy}) scale({sc})" style="fill:{v("glyph")};'
                f'stroke:{v("glyph")};stroke-width:1.6;stroke-linejoin:round">{body}</g>'
            )
        s.rect(x + 8, 16, 28, 28, "none", rx=2, stroke=v("b2"))
        s.text(x + 62, 96, ICON_NAMES[key], "f1", 10, anchor="middle")
    s.text(12, 134, "Left: 16px, as on the sidebar tab. Right: enlarged. One colour (jp-icon3).", "f2", 11)
    return s


MODELS = {
    "b2-closed": b2_closed,
    "b2-open": b2_open,
    "b2-filter": b2_filter,
    "b2-menu": b2_menu,
    "b2-hidden": b2_hidden,
    "b2-new": b2_new,
    "b2-shutdown": b2_shutdown,
    "b2-legend": b2_legend,
    "alt-a": alt_a,
    "alt-b": alt_b,
    "alt-c": alt_c,
    "palette": palette,
    "icons": icon_sheet,
    "open-icons": open_icon_sheet,
}


def main() -> None:
    SVG_DIR.mkdir(exist_ok=True)
    inline = {}
    for name, fn in MODELS.items():
        svg = fn()
        (SVG_DIR / f"{name}.svg").write_text(svg.standalone())
        body = svg.body()
        copy = {t: body.replace('id="card-', f'id="{t}-{name}-card-').replace("url(#card-", f"url(#{t}-{name}-card-")
                for t in ("dark", "light")}
        inline[name] = (
            f'<div class="pair"><figure class="mock" style="{css_vars("dark")}">{copy["dark"]}'
            f'<figcaption>Dark</figcaption></figure>'
            f'<figure class="mock" style="{css_vars("light")}">{copy["light"]}'
            f'<figcaption>Light</figcaption></figure></div>'
        )
    page = (HERE / "design.template.html").read_text()
    for name, html in inline.items():
        page = page.replace("{{svg:" + name + "}}", html)
    assert "{{svg:" not in page, "unknown model marker in design.template.html"
    (HERE / "workspace-manager-design.html").write_text(page)
    print("wrote", len(inline), "models")


if __name__ == "__main__":
    main()
