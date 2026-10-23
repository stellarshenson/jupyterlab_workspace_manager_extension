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

# Token values: dark = the design system's Sublime Dark, light = stock JupyterLab Light.
THEMES = {
    "dark": {
        "l0": "#252b32", "l1": "#303841", "l2": "#404b54", "l3": "#4d5a65",
        "f0": "#e6e6e6", "f1": "#c3c3c3", "f2": "#7d8791",
        "b2": "#404b54", "b3": "#252b32",
        "brand1": "#2196f3", "brand2": "#64b5f6",
        "ok": "#4caf50", "err": "#f44336", "glyph": "#bdbdbd",
        "rose": "#e8bbc6", "peach": "#ddc2a7", "lemon": "#ccc8a6",
        "mint": "#b3cdb1", "sky": "#a5cce5", "lavender": "#cfc1e1",
        "nb": "#ef6c00", "md": "#64b5f6", "py": "#ffca28",
    },
    "light": {
        "l0": "#ffffff", "l1": "#ffffff", "l2": "#eeeeee", "l3": "#bdbdbd",
        "f0": "rgba(0,0,0,1)", "f1": "rgba(0,0,0,.87)", "f2": "rgba(0,0,0,.54)",
        "b2": "#e0e0e0", "b3": "#eeeeee",
        "brand1": "#1976d2", "brand2": "#42a5f5",
        "ok": "#388e3c", "err": "#d32f2f", "glyph": "#616161",
        "rose": "#e39fb1", "peach": "#d2ab82", "lemon": "#bab56d",
        "mint": "#87c086", "sky": "#77bae0", "lavender": "#bfa9da",
        "nb": "#ef6c00", "md": "#1976d2", "py": "#f9a825",
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
        st = f"fill:{v(colour) if not colour.startswith(('var', 'color')) else colour};font-size:{size}px;font-weight:{weight}"
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


def g_eye(s: Svg, x, y, colour="glyph", off=False):
    s.raw(f'<path d="M{x+1.5} {y+8}c2.2 -3.6 4.3 -5 6.5 -5s4.3 1.4 6.5 5c-2.2 3.6 -4.3 5 -6.5 5s-4.3 -1.4 -6.5 -5z" style="fill:none;stroke:{v(colour)};stroke-width:1.2"/>')
    s.raw(f'<circle cx="{x+8}" cy="{y+8}" r="2" style="fill:{v(colour)}"/>')
    if off:
        s.line(x + 2.5, y + 13.5, x + 13.5, y + 2.5, v(colour), 1.3)


def g_open(s: Svg, x, y, colour="glyph"):
    s.raw(f'<path d="M{x+7} {y+3}h-4v10h10v-4" style="fill:none;stroke:{v(colour)};stroke-width:1.2"/>')
    s.raw(f'<path d="M{x+9} {y+2.5}h4.5v4.5M{x+13.5} {y+2.5}l-6 6" style="fill:none;stroke:{v(colour)};stroke-width:1.2"/>')


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


# ---------- shared states, drawn in the style of A ----------

def state_filter() -> Svg:
    s = Svg(W, 300, "Filter active - query claude")
    y = panel_header(s, 0, filter_on=True)
    s.rect(8, y + 6, W - 16, 24, v("l0"), rx=2, stroke=v("brand1"))
    g_filter(s, 14, y + 10, colour="f2")
    s.text(36, y + 22, "claude", "f1", 12)
    s.text(W - 20, y + 22, "x", "f2", 12, anchor="middle")
    y += 36
    s.line(0, y, W, y, v("b2"))
    for name, colour, rows in (
        ("default", "sky", [("7", "now"), ("11", "2m"), ("14", "12m")]),
        ("auto-6", "peach", [("1", "1d")]),
    ):
        top = y
        s.rect(0, y, W, 30, v("l2"))
        g_caret(s, 8, y + 6)
        s.text(26, y + 19, name, "f0", 12, 600)
        s.text(W - 12, y + 19, f"{len(rows)} of {5 if name == 'default' else 1}", "f2", 11, anchor="end")
        y += 30
        for tname, age in rows:
            g_terminal(s, 26, y + 4)
            s.add(
                f'<text x="48" y="{y+16}" style="font-size:12px;fill:{v("f1")}">'
                f'<tspan style="fill:{v("brand2")};font-weight:600">claude</tspan>'
                f'<tspan style="fill:{v("f2")};font-size:11px" dx="8">terminal {tname}</tspan></text>'
            )
            s.text(W - 12, y + 16, age, age_colour(age), 11, anchor="end")
            y += 24
        s.rect(0, top, 4, y - top, v(colour))
        s.line(0, y, W, y, v("b3"))
    s.rect(0, y, W, 30, v("l2"))
    g_unassigned(s, 24, y + 7)
    s.text(44, y + 19, "In no workspace", "f1", 12, 600)
    s.text(W - 12, y + 19, "4 of 10", "f2", 11, anchor="end")
    y += 30
    s.text(14, y + 22, "4 workspaces without a match are not shown", "f2", 11, italic=True)
    s.h = y + 34
    return s


def state_menu() -> Svg:
    s = Svg(W, 330, "Workspace menu")
    y = panel_header(s, 0)
    s.rect(0, y, W, 44, v("l3"))
    s.rect(0, y, 4, 44, v("peach"))
    g_caret(s, 8, y + 6, open_=False)
    s.text(26, y + 18, "auto-6", "f1", 12, 600)
    s.text(26, y + 35, "Firmware upload tests", "f2", 11, italic=True)
    icon_button(s, W - 30, y + 3, g_dots, active=True)
    my = y + 30
    mx, mw = 112, 184
    items = [
        ("Open workspace", "", None), ("Open in new browser tab", "", None), ("Close all tabs", "", None), None,
        ("Set purpose...", "", None), ("Colour", ">", None), ("Hide workspace", "", "eye"), None,
        ("Delete workspace", "", "danger"),
    ]
    h = sum(8 if it is None else 24 for it in items) + 8
    s.rect(mx + 2, my + 3, mw, h, "rgba(0,0,0,.25)", rx=2)
    s.rect(mx, my, mw, h, v("l1"), rx=2, stroke=v("b2"))
    iy = my + 4
    for it in items:
        if it is None:
            s.line(mx + 8, iy + 4, mx + mw - 8, iy + 4, v("b2"))
            iy += 8
            continue
        label, right, mod = it
        if label == "Hide workspace":
            s.rect(mx + 1, iy, mw - 2, 24, v("l2"))
            g_eye(s, mx + 8, iy + 4, colour="f1", off=True)
        s.text(mx + 30, iy + 16, label, "err" if mod == "danger" else "f1", 12)
        if right:
            s.text(mx + mw - 12, iy + 16, ">", "f2", 11, anchor="end")
        iy += 24
    s.h = my + h + 12
    return s


def state_hidden() -> Svg:
    s = Svg(W, 250, "Hidden workspaces shown")
    y = panel_header(s, 0, hidden_on=True)
    for name, colour, age, hidden in (
        ("default", "sky", "now", False), ("auto-6", "peach", "3d", False),
        ("iconprobe", "rose", "2d", True), ("fb-exp-rename-base", "mint", "1d", True),
        ("fb-exp-simcheck", "lemon", "1d", True),
    ):
        s.rect(0, y, W, 30, v("l2"))
        s.rect(0, y, 4, 30, v(colour))
        g_caret(s, 8, y + 6, open_=False)
        s.text(26, y + 19, name, "f2" if hidden else "f1", 12, 600, italic=hidden)
        s.text(W - 34, y + 19, age, age_colour(age), 11, anchor="end")
        if hidden:
            icon_button(s, W - 30, y + 3, g_eye, off=True)
        else:
            icon_button(s, W - 30, y + 3, g_dots)
        y += 30
        s.line(0, y, W, y, v("b3"))
    s.text(14, y + 22, "Click the eye to show a workspace again", "f2", 11, italic=True)
    s.h = y + 34
    return s


# ---------- palette and icons ----------

def palette() -> Svg:
    names = ["rose", "peach", "lemon", "mint", "sky", "lavender"]
    s = Svg(560, 120, "Workspace palette in rotation order")
    for i, n in enumerate(names):
        x = 12 + i * 90
        s.rect(x, 12, 80, 44, v("l2"), rx=2)
        s.rect(x, 12, 6, 44, v(n))
        s.text(x + 14, 30, f"{i + 1}. {n}", "f1", 11)
        s.text(x + 14, 46, "strip", "f2", 10)
        s.rect(x, 64, 80, 26, tint(n, 22), rx=2)
        s.text(x + 8, 81, "header tint", "f2", 10)
    s.text(12, 110, "Order of rotation: 1 to 6, then 1 again. Values follow the colourful tab palette (see the page).", "f2", 11)
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
    "alt-a": alt_a,
    "alt-b": alt_b,
    "alt-c": alt_c,
    "state-filter": state_filter,
    "state-menu": state_menu,
    "state-hidden": state_hidden,
    "palette": palette,
    "icons": icon_sheet,
}


def main() -> None:
    SVG_DIR.mkdir(exist_ok=True)
    inline = {}
    for name, fn in MODELS.items():
        svg = fn()
        (SVG_DIR / f"{name}.svg").write_text(svg.standalone())
        body = svg.body()
        inline[name] = (
            f'<div class="pair"><figure class="mock" style="{css_vars("dark")}">{body}'
            f'<figcaption>Dark</figcaption></figure>'
            f'<figure class="mock" style="{css_vars("light")}">{body}'
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
