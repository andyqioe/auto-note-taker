#!/usr/bin/env python3
"""Regenerate the README's wizard screenshots (docs/images/wizard-*.png).

Drives the real wizard in a pseudo-terminal with a staged home (a ~/code/storefront project and a
~/Documents/Notes vault Obsidian knows about), renders each screen in the README's terminal frame, and
captures it with headless Chrome at 2x. Needs macOS or Linux, Google Chrome, and `pip install pyte`.

  python3 docs/make-screenshots.py [output dir, default docs/images]
"""
import html, json, os, pty, select, shutil, struct, subprocess, sys, tempfile, time, fcntl, termios
from pathlib import Path
import pyte

REPO = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "docs/images"
HERE = Path(tempfile.mkdtemp(prefix="ant-", dir="/tmp")).resolve()  # short, so paths in the review diff stay readable; resolved, since macOS /tmp is /private/tmp and the project must sit under HOME
OUT.mkdir(parents=True, exist_ok=True)
COLS, ROWS = 84, 40
CHROME = os.environ.get("CHROME") or next((c for c in ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", shutil.which("google-chrome") or "", shutil.which("chromium") or ""] if c and Path(c).exists()), "google-chrome")

# ---- staged home: a project and an Obsidian vault Obsidian knows about
home = HERE / "home"
proj = home / "code/storefront"
proj.mkdir(parents=True)
subprocess.run(["git", "init", "-q", str(proj)], check=True)
(proj / "AGENTS.md").write_text("# Storefront\n\nUse pnpm.\n")
vault = home / "Documents/Notes"
for d in [".obsidian", "Journal", "Reading", "Projects/storefront/Meetings", "Projects/checkout"]:
    (vault / d).mkdir(parents=True, exist_ok=True)
reg = home / "Library/Application Support/obsidian"
reg.mkdir(parents=True)
(reg / "obsidian.json").write_text(json.dumps({"vaults": {"a": {"path": str(vault), "ts": 1}}}))

screen = pyte.Screen(COLS, ROWS)
stream = pyte.ByteStream(screen)
pid = fd = None


def start(*args):
    """Runs the installer with `args` in the staged project, on a fresh screen."""
    global pid, fd
    screen.reset()
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(proj)
        os.environ.update(HOME=str(home), TERM="xterm-256color", COLORTERM="truecolor")
        os.environ.pop("NO_COLOR", None)
        os.execvp("node", ["node", str(REPO / "bin/install.mjs"), *args])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))


start()


def pump(t=0.5):
    end = time.time() + t
    while time.time() < end:
        if select.select([fd], [], [], 0.05)[0]:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            # pyte has no "dim": carry it as blink (SGR 5) so the renderer can tell it apart
            stream.feed(data.replace(b"\x1b[2m", b"\x1b[5m").replace(b"\x1b[22m", b"\x1b[22;25m"))


KEYS = {"ctrl-u": b"\x15", "enter": b"\r", "down": b"\x1b[B", "up": b"\x1b[A", "home": b"\x1b[H", "end": b"\x1b[F", "space": b" "}


def send(*keys):
    for k in keys:
        os.write(fd, KEYS.get(k, k.encode()))
        pump(0.12)


COLOR = {"default": "#e9e9ee", "green": "#4ade80", "brown": "#facc15", "yellow": "#facc15", "red": "#f87171"}
DIM = "#8b8b96"


def color(ch):
    if ch.blink:
        return DIM
    fg = ch.fg
    if fg in COLOR:
        return COLOR[fg]
    return "#" + fg if len(fg) == 6 else COLOR["default"]


def rows():
    lines = []
    for y in range(ROWS):
        row = screen.buffer[y]
        cells = [row[x] for x in range(COLS)]
        while cells and cells[-1].data == " ":
            cells.pop()
        lines.append(cells)
    while lines and not lines[-1]:
        lines.pop()
    while lines and not lines[0]:
        lines.pop(0)
    return lines


def to_html(lines):
    out = []
    for cells in lines:
        parts, run, key = [], "", None
        for ch in cells:
            k = (color(ch), ch.bold)
            if k != key and run:
                parts.append((key, run)); run = ""
            key = k; run += ch.data
        if run:
            parts.append((key, run))
        out.append("".join(f'<span style="color:{c};{"font-weight:700;" if b else ""}">{html.escape(t)}</span>' for (c, b), t in parts) or "&nbsp;")
    return "".join(f"<div class=l>{l}</div>" for l in out)


PAGE = """<!doctype html><html><head><meta charset=utf-8>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=block" rel=stylesheet>
<style>
html,body{{margin:0;background:#0b0b10}}
.bg{{width:786px;padding:37px;box-sizing:border-box;background:radial-gradient(120% 140% at 0% 0%,#2e2a83 0%,#17163a 38%,#0c0c13 75%)}}
.win{{background:#121217;border:1px solid #2b2b33;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45);overflow:hidden}}
.bar{{height:34px;display:flex;align-items:center;justify-content:center;position:relative;background:#18181e;border-bottom:1px solid #24242b;
  font:400 12.5px/1 'JetBrains Mono',monospace;color:#8b8b96;letter-spacing:.2px}}
.dots{{position:absolute;left:14px;top:11px;display:flex;gap:8px}}.dots i{{width:12px;height:12px;border-radius:50%;display:block}}
.term{{padding:16px 20px 18px;font:400 13.4px/21.5px 'JetBrains Mono',monospace;white-space:pre;color:#e9e9ee;font-variant-ligatures:none}}
</style></head><body><div class=bg id=shot><div class=win><div class=bar><div class=dots><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>~/code/storefront · {title}</div>
<div class=term>{body}</div></div></div></body></html>"""


def shoot(name, title="npx auto-note-taker"):
    pump(0.6)
    lines = rows()
    page = HERE / f"{name}.html"
    page.write_text(PAGE.format(body=to_html(lines), title=html.escape(title)))
    height = round(37 * 2 + 34 + 1 + 16 + 18 + 2 + 21.5 * len(lines))
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=2", f"--window-size=786,{height}",
                    "--virtual-time-budget=4000", f"--screenshot={OUT / (name + '.png')}", page.as_uri()],
                   check=True, capture_output=True)
    if not (OUT / (name + ".png")).is_file():
        sys.exit(f"Chrome wrote no {name}.png; set CHROME to a Chrome or Chromium binary")
    print(name, len(lines), "lines")


pump(1.5)
send("enter")                                   # project: this folder
shoot("wizard-notes-folder")
send("down", "enter")                           # Obsidian · Notes -> browser at the vault root
send("down", "enter")                           # Journal, [Projects], Reading -> Projects
send("down", "enter")                           # checkout, [storefront] -> storefront
shoot("wizard-browse")
send("home", "enter")                           # ✓ Use this folder
send("down", "down", "down", "space")           # tick Decisions & tradeoffs
send("end", "enter"); send(*"Perf wins"); send("enter")
send(*"a change measurably sped something up"); send("enter")
send("enter")                                   # keep the suggested sections
send("enter")                                   # no extra instructions
shoot("wizard-record")
send("enter")
send("end", "enter"); send(*"anything about the CI provider"); send("enter")
shoot("wizard-never-record")
send("enter")
send("space", "down", "down", "space")          # tick ASD-STE100 and BLUF
shoot("wizard-style")
send("enter")
send("down")                                    # always English
shoot("wizard-language")
send("enter")
shoot("wizard-styling")
send("enter")
shoot("wizard-confirm")
send("enter")
pump(1.0)
shoot("wizard-done")
os.waitpid(pid, 0)

start("update")                                 # later: add a kind of your own to the same install
pump(1.5)
shoot("wizard-update-record", "npx auto-note-taker update")
send("end", "enter"); send(*"To-dos"); send("enter")
send(*'the user says "add X to todo"'); send("enter")
send("ctrl-u"); send(*"Task, Context, Done when, Links")
shoot("wizard-update-sections", "npx auto-note-taker update")
send("enter")
send(*"keep To-dos/To-dos.md as a summary page linking every to-do"); send("enter")
send("enter")
send("enter")                                   # keep the writing styles
send("enter")                                   # keep the language
shoot("wizard-update", "npx auto-note-taker update")
send("d", "end")                                # review the AGENTS.md diff at the new kind's section, then back
shoot("wizard-review", "npx auto-note-taker update")
send("enter")
send("enter")
pump(1.0)
shoot("wizard-update-done", "npx auto-note-taker update")
os.waitpid(pid, 0)
shutil.rmtree(HERE, ignore_errors=True)
