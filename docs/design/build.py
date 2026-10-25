"""Build the SVG models and the design proposal page.

Run from the repository root: python docs/design/build.py
Writes docs/design/svg/*.svg (standalone, dark by default, light under
prefers-color-scheme) and docs/design/workspace-manager-design.html, which
inlines every model twice, once per theme.
"""

from html import escape
from pathlib import Path

HERE = Path(__file__).parent
SVG_DIR = HERE / "svg"
FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
W = 300  # sidebar width of the models

# Token values: dark = Galaxa Dark Theme - Steel, read from the live lab on 2026-10-23;
# light = stock JupyterLab Light. <colour>-act is the active tab shade of
# jupyterlab_colourful_tab_extension, the same value in the lab's settings.
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
        "rose-act": "#3a2328",
        "peach-act": "#3a3126",
        "lemon-act": "#3a3825",
        "mint-act": "#253b2a",
        "sky-act": "#1d2a38",
        "lavender-act": "#30253a",
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
        "rose-act": "#e39fb1",
        "peach-act": "#d2ab82",
        "lemon-act": "#bab56d",
        "mint-act": "#87c086",
        "sky-act": "#77bae0",
        "lavender-act": "#bfa9da",
    },
}


def css_vars(theme: str) -> str:
    return ";".join(f"--m-{k}:{v}" for k, v in THEMES[theme].items())


def v(name: str) -> str:
    return f"var(--m-{name})"


def active_shade(colour: str) -> str:
    return v(f"{colour}-act")


def selected_body(colour: str) -> str:
    """The body of this window's open card: 40% of the active shade over the panel."""
    return f"color-mix(in srgb, {active_shade(colour)} {BODY_MIX}%, {v('l1')})"


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

    def text(self, x, y, s, colour="f1", size=12, weight=400, anchor="start", italic=False, spacing=0, upper=False):
        if upper:
            s = s.upper()
        st = f"fill:{v(colour) if not colour.startswith(('var', 'color', '#')) else colour};font-size:{size}px;font-weight:{weight}"
        if italic:
            st += ";font-style:italic"
        if spacing:
            st += f";letter-spacing:{spacing}px"
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


# ---------- Design B refined (selected by the Star Colonel on 2026-10-23) ----------

# Font sizes of Galaxa Dark Theme - Steel: --jp-ui-font-size1 is 11px, size2 1.2em of it,
# size0 0.8333em. Every text on a card header is colour 0 (contrast >= 4.9:1 on the
# strongest tint); body details are colour 1 (4.8:1 on layout-color1).
FS0, FS1, FS2 = 9.2, 11, 13.2
TINT, BODY_MIX = 8, 40
TAB_PATH = "M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 16H3V5h10v4h8z"
KERNEL_PATH = (
    "M15 9H9v6h6zm-2 4h-2v-2h2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2"
    "c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2zm-4 6H7V7h10z"
)


def g_tab(s: Svg, x, y, colour="f1", size=16):
    """JupyterLab's own tabIcon (ui-components sidebar/tab.svg)."""
    s.raw(f'<path transform="translate({x},{y}) scale({size / 24})" d="{TAB_PATH}" style="fill:{v(colour)}"/>')


def g_kern(s: Svg, x, y, colour="f1", size=16):
    """JupyterLab's own kernelIcon (ui-components statusbar/kernel.svg)."""
    s.raw(f'<path transform="translate({x},{y}) scale({size / 24})" d="{KERNEL_PATH}" style="fill:{v(colour)}"/>')


def dot(s: Svg, cx, cy, colour, r=3.5):
    s.raw(f'<circle cx="{cx}" cy="{cy}" r="{r}" style="fill:{v(colour)}"/>')


def b2_age(s: Svg, xr, y, age):
    """Age right-aligned at xr; 'now' is colour 0 semibold with the activity dot."""
    if age == "now":
        s.text(xr, y, "now", "f0", FS1, 600, anchor="end")
        dot(s, xr - 31, y - 4, "brand2", 3)
    else:
        s.text(xr, y, age, "f0", FS1, anchor="end")


def b2_counts(s: Svg, xr, y, n):
    """Tabs, terminals, kernels, right-aligned at xr; None skips one."""
    x = xr
    for glyph, num in reversed(list(zip(("tab", "term", "kern"), n))):
        if num is None:
            continue
        x -= 7 * len(str(num))
        s.text(x, y + 12, str(num), "f0", FS1)
        x -= 18
        {"tab": lambda: g_tab(s, x, y, "f1"), "term": lambda: g_terminal(s, x, y, "f1"),
         "kern": lambda: g_kern(s, x, y, "f1")}[glyph]()
        x -= 8


def b2_panel_header(s: Svg, y, count="11", filter_on=False, hidden_on=False):
    s.rect(0, y, W, 32, v("l1"))
    s.line(0, y + 32, W, y + 32, v("b2"))
    s.runs(14, y + 20, [("WORKSPACES", "f0", FS1, 600, False, 0), (f"({count})", "f1", FS1, 400, False, 8)])
    icon_button(s, W - 108, y + 4, g_plus)
    icon_button(s, W - 82, y + 4, g_filter, active=filter_on)
    icon_button(s, W - 56, y + 4, g_eye, active=hidden_on)
    icon_button(s, W - 30, y + 4, g_refresh)
    return y + 33


def b2_header(s: Svg, x, y, w, ws, n, open_, hover=False, current=False, hidden=False, right_text=None):
    two_lines = bool(ws.get("purpose") or right_text or n is not None)
    h = 46 if two_lines else 32
    g_caret(s, x + 9, y + 8, open_=open_, colour="f0")
    s.text(x + 28, y + 20, ws["name"], "f0", FS2, 600)
    if hidden:
        icon_button(s, x + w - 28, y + 4, g_eye, off=True)
        s.text(x + w - 34, y + 20, "hidden", "f0", FS1, anchor="end")
    else:
        if not hover:
            b2_age(s, x + w - 34, y + 20, ws["age"])
        icon_button(s, x + w - 28, y + 4, g_dots, hover=hover)
    if hover:
        # the hover icons take the age's place, so the name keeps its width
        icon_button(s, x + w - 104, y + 4, g_open_ws, hover=True)
        icon_button(s, x + w - 80, y + 4, g_closeall, hover=True)
    if ws.get("purpose"):
        # the panel ellipsises the purpose before the counts; about 24 characters fit at 284px
        purpose = ws["purpose"] if len(ws["purpose"]) <= 24 else ws["purpose"][:23].rstrip() + "\u2026"
        s.text(x + 28, y + 38, purpose, "f0", FS1)
    if right_text:
        s.text(x + w - 10, y + 38, right_text, "f0", FS1, anchor="end")
    elif n is not None:
        b2_counts(s, x + w - 10, y + 26, n)
    return y + h


def b2_group(s: Svg, x, y, label, num):
    s.runs(x, y + 15, [(label.upper(), "f1", FS0, 600, False, 0), (f"({num})", "f1", FS0, 600, False, 6)])
    return y + 21


def b2_row(s: Svg, x, y, w, kind, label, detail, right, hover=False, state=None):
    if hover:
        # a veil of the text colour, so the hover reads on a neutral body and on a shade alike
        s.rect(x + 4, y, w - 4, 24, "color-mix(in srgb, var(--m-f0) 12%, transparent)")
    gx = x + 14
    if kind == "term":
        g_terminal(s, gx, y + 4, "f1")
    elif kind == "kern":
        g_kern(s, gx, y + 4, "f1")
    else:
        g_file(s, gx, y + 4, kind)
    # a hovered row lifts its detail to colour 0: under the veil it reads 5.2:1 or more
    s.runs(gx + 22, y + 16, [(label, "f0", FS1, 400, False, 0)] +
           ([(detail, "f0" if hover else "f1", FS1, 400, False, 8)] if detail else []))
    if state:
        dot(s, x + w - 46, y + 12, state, 3.5)
    if right == "now":
        b2_age(s, x + w - 10, y + 16, "now")
    elif right:
        s.text(x + w - 10, y + 16, right, "f1", FS1, anchor="end")
    return y + 24


CARD_R = 3  # corner radius of a card


def card_frame(s: Svg, idx, x, top, w, header_bottom, bottom, ws, open_, current):
    """Paint a card under the content drawn since parts[idx]: one rounded shape; inside it,
    square layers clipped by the shape - header, body, then the strip on top; then the outline,
    flush against the card's edge, or the border of another open card."""
    h, hh = bottom - top, header_bottom - top
    cid = s.uid("card")
    sq = lambda rx, ry, rw, rh, fill: (
        f'<rect x="{rx}" y="{ry}" width="{rw}" height="{rh}" style="fill:{fill}"/>' if rh > 0 else "")
    layers = [f'<clipPath id="{cid}"><rect x="{x}" y="{top}" width="{w}" height="{h}" rx="{CARD_R}"/></clipPath>',
              f'<g clip-path="url(#{cid})">']
    if current:
        layers += [sq(x, top, w, hh, active_shade(ws["colour"])),
                   sq(x, header_bottom, w, h - hh, selected_body(ws["colour"]))]
    else:
        layers += [sq(x, top, w, hh, tint(ws["colour"], TINT)),
                   sq(x, header_bottom, w, h - hh, v("l1"))]
    layers += [sq(x, top, 4, h, v(ws["colour"])), "</g>"]
    s.parts.insert(idx, "".join(layers))
    if current:
        # centre line 1px outside the card, 2px wide: the outline touches the card's edge;
        # radius CARD_R + 1 keeps it concentric with the card's corners
        s.rect(x - 1, top - 1, w + 2, h + 2, "none", rx=CARD_R + 1, stroke=v("brand2"), sw=2)
    elif open_:
        s.rect(x + 0.5, top + 0.5, w - 1, h - 1, "none", rx=CARD_R - 0.5, stroke=tint(ws["colour"], 55))


def b2_card(s: Svg, x, y, w, ws, n, open_=False, hover=False, current=False, hover_row=None, rows=None):
    top, idx = y, len(s.parts)
    y = hb = b2_header(s, x, y, w, ws, n, open_, hover=hover, current=current)
    if not open_:
        card_frame(s, idx, x, top, w, hb, hb, ws, False, current)
        return y
    y += 4
    groups = rows or [
        ("Tabs", [(k, name, folder, "", None) for k, name, folder in ws["docs"]]),
        ("Terminals", [("term", proc, f"terminal {nm}", age, None) for proc, nm, age in ws["terms"]]),
        ("Kernels", [("kern", kn, nb, age, st) for kn, nb, age, st in ws["kernels"]]),
    ]
    i = 0
    for label, items in groups:
        y = b2_group(s, x + 14, y, label, len(items))
        for kind, lab, det, right, st in items:
            y = b2_row(s, x, y, w, kind, lab, det, right, hover=(i == hover_row), state=st)
            i += 1
        y += 4
    card_frame(s, idx, x, top, w, hb, y, ws, True, current)
    return y


def b2_footer(s: Svg, x, y, w, hidden_n=3):
    s.rect(x, y, w, 32, "none", rx=3, stroke=v("f2"), dash="3 2")
    g_unassigned(s, x + 12, y + 8, colour="f1")
    s.text(x + 34, y + 20, "In no workspace", "f0", FS2 - 1, 600)
    b2_counts(s, x + w - 10, y + 8, (None, 10, 0))
    y += 38
    s.rect(x, y, w, 32, v("l2"), rx=3)
    s.text(x + 14, y + 20, "Other sessions", "f0", FS2 - 1, 600)
    s.text(x + w - 10, y + 20, "(2)", "f0", FS1, anchor="end")
    y += 40
    if hidden_n:
        g_eye(s, x + 4, y, colour="f1", off=True)
        s.text(x + 26, y + 12, f"{hidden_n} hidden workspaces", "f0", FS1)
        y += 24
    return y


B2_OTHERS = [
    {"name": "iconprobe2", "colour": "mint", "purpose": "", "age": "8h", "n": (1, 0, 0)},
    {"name": "auto-6", "colour": "peach", "purpose": "Firmware upload tests", "age": "3d", "n": (0, 1, 0)},
    {"name": "wf-regression-hist-1", "colour": "lemon", "purpose": "Regression history workflow", "age": "3d", "n": (2, 0, 1)},
    {"name": "fb-exp-panels-base", "colour": "lavender", "purpose": "", "age": "4d", "n": (0, 0, 0)},
]


def b2_closed() -> Svg:
    s = Svg(W, 520, "Design B refined - load state, no card open")
    y = b2_panel_header(s, 0) + 8
    x, w = 8, W - 16
    y = b2_card(s, x, y, w, DEFAULT_WS, (3, 5, 1), current=True) + 6
    for o in B2_OTHERS:
        y = b2_card(s, x, y, w, o, o["n"], hover=(o["name"] == HOVER)) + 6
    s.h = b2_footer(s, x, y, w) + 8
    return s


def b2_open() -> Svg:
    s = Svg(W, 720, "Design B refined - this window's workspace opened by a click")
    y = b2_panel_header(s, 0) + 8
    x, w = 8, W - 16
    y = b2_card(s, x, y, w, DEFAULT_WS, (3, 5, 1), open_=True, current=True, hover_row=4) + 6
    for o in B2_OTHERS[:3]:
        y = b2_card(s, x, y, w, o, o["n"]) + 6
    s.h = b2_footer(s, x, y, w) + 8
    return s


def b2_filter() -> Svg:
    s = Svg(W, 400, "Design B refined - filter claude")
    y = b2_panel_header(s, 0, filter_on=True)
    s.rect(8, y + 6, W - 16, 26, "color-mix(in srgb, #000 4%, var(--m-l1))", rx=2, stroke=v("brand1"))
    g_filter(s, 14, y + 11, colour="f1")
    s.text(36, y + 23, "claude", "f0", FS1)
    s.text(W - 20, y + 23, "x", "f1", FS1 + 1, anchor="middle")
    y += 40
    x, w = 8, W - 16
    matches = [
        (DEFAULT_WS, True, [("Terminals", [("term", "claude", "terminal 7", "now", None),
                                           ("term", "claude", "terminal 11", "2m", None),
                                           ("term", "claude", "terminal 14", "12m", None)])], "(3 of 9)"),
        (B2_OTHERS[1], False, [("Terminals", [("term", "claude", "terminal 1", "1d", None)])], "(1 of 1)"),
    ]
    for ws, current, rows, of in matches:
        top, idx = y, len(s.parts)
        y = hb = b2_header(s, x, y, w, ws, None, True, current=current, right_text=of)
        y += 4
        for label, items in rows:
            y = b2_group(s, x + 14, y, label, len(items))
            for kind, lab, det, right, st in items:
                y = b2_row(s, x, y, w, kind, lab, det, right)
        y += 6
        card_frame(s, idx, x, top, w, hb, y, ws, True, current)
        y += 6
    s.rect(x, y, w, 32, "none", rx=3, stroke=v("f2"), dash="3 2")
    g_unassigned(s, x + 12, y + 8, colour="f1")
    s.text(x + 34, y + 20, "In no workspace", "f0", FS2 - 1, 600)
    s.text(x + w - 10, y + 20, "(4 of 10)", "f0", FS1, anchor="end")
    y += 40
    s.text(14, y + 10, "4 workspaces without a match are not shown", "f0", FS1)
    s.h = y + 22
    return s


def b2_menu() -> Svg:
    s = Svg(W + 116, 330, "Design B refined - workspace menu with the Colour submenu")
    # the submenu reaches past the sidebar into the main area
    s.rect(W, 0, 116, 400, v("l0"))
    s.line(W, 0, W, 400, v("b2"))
    y = b2_panel_header(s, 0) + 8
    x, w = 8, W - 16
    top, idx = y, len(s.parts)
    y = b2_header(s, x, y, w, B2_OTHERS[1], (0, 1, 0), False)
    card_frame(s, idx, x, top, w, y, y, B2_OTHERS[1], False, False)
    icon_button(s, x + w - 28, top + 4, g_dots, active=True)
    my, mx, mw = top + 32, 108, 188
    colour = B2_OTHERS[1]["colour"]
    # every item has an icon; Delete carries the error colour on its icon only, since the
    # error colour reads 3.2:1 as text in Galaxa Steel
    items = [
        ("Open workspace", lambda gx, gy: g_open_ws(s, gx, gy, "f1"), None),
        ("Open in new browser tab", lambda gx, gy: g_open(s, gx, gy, "f1"), None),
        ("Close all tabs", lambda gx, gy: g_closeall(s, gx, gy, "f1"), None), None,
        ("Set description...", lambda gx, gy: g_pencil(s, gx, gy, "f1"), None),
        ("Colour", lambda gx, gy: g_swatch(s, gx, gy, colour), ">"),
        ("Hide workspace", lambda gx, gy: g_eye(s, gx, gy, "f1", off=True), None), None,
        ("Delete workspace", lambda gx, gy: g_bin(s, gx, gy, "err"), None),
    ]
    h = sum(8 if it is None else 26 for it in items) + 8
    s.rect(mx + 2, my + 3, mw, h, "rgba(0,0,0,.25)", rx=2)
    s.rect(mx, my, mw, h, v("l1"), rx=2, stroke=v("l3"))
    iy = my + 4
    for it in items:
        if it is None:
            s.line(mx + 8, iy + 4, mx + mw - 8, iy + 4, v("l3"))
            iy += 8
            continue
        label, glyph, mod = it
        if mod == ">":
            s.rect(mx + 1, iy, mw - 2, 26, v("l2"))
        glyph(mx + 8, iy + 5)
        s.text(mx + 32, iy + 17, label, "f0", FS1 + 1)
        if mod == ">":
            s.text(mx + mw - 12, iy + 17, ">", "f1", FS1, anchor="end")
            sub_y = iy
        iy += 26
    # the open submenu: the names and swatches of the colourful tab extension's Tab Colour menu
    names = [("rose", "Red"), ("peach", "Orange"), ("lemon", "Yellow"), ("mint", "Green"), ("sky", "Blue"), ("lavender", "Purple")]
    sx, sy, sw = mx + mw - 2, sub_y - 4, 112
    sh = len(names) * 26 + 8
    s.rect(sx + 2, sy + 3, sw, sh, "rgba(0,0,0,.25)", rx=2)
    s.rect(sx, sy, sw, sh, v("l1"), rx=2, stroke=v("l3"))
    for k, (cid, label) in enumerate(names):
        g_swatch(s, sx + 8, sy + 4 + k * 26 + 5, cid)
        s.text(sx + 32, sy + 4 + k * 26 + 17, label, "f0", FS1 + 1)
    s.h = max(my + h, sy + sh) + 12
    return s


def b2_hidden() -> Svg:
    s = Svg(W, 330, "Design B refined - hidden workspaces shown")
    y = b2_panel_header(s, 0, hidden_on=True) + 8
    x, w = 8, W - 16
    rows = [
        (DEFAULT_WS, False, True), (B2_OTHERS[1], False, False),
        ({"name": "iconprobe", "colour": "rose", "purpose": "", "age": "2d"}, True, False),
        ({"name": "fb-exp-rename-base", "colour": "mint", "purpose": "", "age": "1d"}, True, False),
        ({"name": "fb-exp-simcheck", "colour": "lemon", "purpose": "", "age": "1d"}, True, False),
    ]
    for ws, hidden, current in rows:
        top, idx = y, len(s.parts)
        y = b2_header(s, x, y, w, ws, None if hidden else ws.get("n", (3, 5, 1)), False, current=current, hidden=hidden)
        card_frame(s, idx, x, top, w, y, y, ws, False, current)
        y += 6
    s.text(14, y + 12, "The eye button shows a hidden workspace again", "f0", FS1)
    s.h = y + 24
    return s


def b2_new() -> Svg:
    """The dialog of the + button: filled in, and a name that exists."""
    s = Svg(560, 276, "Design B refined - New workspace dialog")
    field = "color-mix(in srgb, #000 4%, var(--m-l1))"
    states = [
        ("fb-review", "Review of the feedback runs before\nthe release of the new grader", None),
        ("auto-6", "", "A workspace named auto-6 exists"),
    ]
    for i, (name, purpose, error) in enumerate(states):
        x, y, w = 8 + i * 276, 8, 268
        s.rect(x + 2, y + 3, w, 260, "rgba(0,0,0,.25)", rx=2)
        s.rect(x, y, w, 260, v("l1"), rx=2, stroke=v("l3"))
        s.text(x + 16, y + 28, "New workspace", "f0", FS2, 600)
        s.text(x + 16, y + 54, "Name", "f0", FS1)
        s.rect(x + 16, y + 60, w - 32, 26, field, rx=2, stroke=v("err" if error else "brand1"))
        s.text(x + 24, y + 77, name, "f0", FS1 + 1)
        if error:
            dot(s, x + 20, y + 98, "err", 3.5)
            s.text(x + 28, y + 102, error, "f0", FS1)
        else:
            s.text(x + 16, y + 102, "Letters, digits, - and _", "f1", FS1)
        s.text(x + 16, y + 128, "Short description (optional)", "f0", FS1)
        # three lines that wrap the text: 100 characters fill about three lines at this width
        s.rect(x + 16, y + 134, w - 32, 58, field, rx=2, stroke=v("l3"))
        for k, line in enumerate(purpose.split("\n") if purpose else []):
            s.text(x + 24, y + 151 + k * 16, line, "f0", FS1 + 1)
        # the counter counts the characters typed; a wrap is not a character
        s.text(x + w - 16, y + 208, f"{len(purpose.replace(chr(10), ' '))}/100", "f1", FS1, anchor="end")
        bx = x + w - 16 - 64
        s.rect(bx, y + 222, 64, 26, v("l3") if error else v("brand1"), rx=2)
        s.text(bx + 32, y + 239, "Create", "f2" if error else "#fff", FS1 + 1, 600, anchor="middle")
        bx -= 72
        s.rect(bx, y + 222, 64, 26, v("l2"), rx=2)
        s.text(bx + 32, y + 239, "Cancel", "f0", FS1 + 1, anchor="middle")
    return s


def b2_legend() -> Svg:
    s = Svg(560, 140, "Icons and marks of design B refined")
    items = [
        ("tab", "Tab count", "tabIcon"), ("term", "Terminal", "own glyph"),
        ("kern", "Kernel / notebook", "kernelIcon"),
    ]
    x = 12
    for kind, name, src in items:
        s.rect(x, 10, 170, 44, v("l2"), rx=2)
        {"tab": lambda: g_tab(s, x + 12, 24, "f0"), "term": lambda: g_terminal(s, x + 12, 24, "f0"),
         "kern": lambda: g_kern(s, x + 12, 24, "f0")}[kind]()
        s.text(x + 38, 30, name, "f0", FS1 + 1, 600)
        s.text(x + 38, 45, src, "f1", FS1)
        x += 180
    x = 12
    for colour, label in (("ok", "kernel idle"), ("brand2", "kernel busy, or active under 60 s"), ("l4", "kernel state unknown")):
        dot(s, x + 6, 74, colour, 4)
        s.text(x + 16, 78, label, "f0", FS1)
        x += {"ok": 90, "brand2": 220}.get(colour, 0)
    g_caret(s, 12, 96, open_=False, colour="f0")
    g_caret(s, 28, 96, open_=True, colour="f0")
    s.text(50, 109, "closed / open; triangle toggles, header switches", "f0", FS1)
    card_frame(s, len(s.parts), 330, 94, 40, 114, 114, {"colour": "sky"}, False, True)
    s.text(380, 109, "this window's workspace", "f0", FS1)
    return s


# ---------- palette and icons ----------

def palette() -> Svg:
    names = ["rose", "peach", "lemon", "mint", "sky", "lavender"]
    s = Svg(560, 184, "Workspace palette in rotation order")
    for i, n in enumerate(names):
        x = 12 + i * 90
        s.rect(x, 12, 80, 44, v("l2"), rx=2)
        s.rect(x, 12, 6, 44, v(n))
        s.text(x + 14, 30, f"{i + 1}. {n}", "f0", 11, 600)
        s.text(x + 14, 46, "strip", "f0", 11)
        s.rect(x, 64, 80, 26, tint(n, TINT), rx=2)
        s.text(x + 8, 81, f"header {TINT}%", "f0", 11)
        s.rect(x, 96, 80, 26, active_shade(n), rx=2)
        s.text(x + 8, 113, "selected header", "f0", 11)
        s.rect(x, 128, 80, 26, selected_body(n), rx=2)
        s.text(x + 8, 145, "selected body", "f0", 11)
    s.text(12, 174, "Order of rotation: 1 to 6, then 1 again. Values follow the colourful tab palette (see the page).", "f0", 11)
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
