"""Pack this actual classic-script app into a standalone offline HTML ZIP."""
import base64
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def pack():
    html = (ROOT / "index.html").read_text()
    css = (ROOT / "style.css").read_text()
    for name in ("plex-sans.woff2", "plex-sans-semibold.woff2"):
        data = base64.b64encode((ROOT / "fonts" / name).read_bytes()).decode()
        css = re.sub(
            r"url\(([\"']?)fonts/" + re.escape(name) + r"\1\)",
            'url("data:font/woff2;base64,' + data + '")',
            css,
        )
    html = re.sub(r"^\s*<link rel=\"preload\"[^>]+>\n", "\n", html, flags=re.M)
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")
    for name in ("parser.js", "samples.js", "app.js"):
        script = (ROOT / name).read_text().replace("</script", "<\\/script")
        needle = '<script src="' + name + '" defer></script>'
        # Inline classic scripts run after body parsing, just as their defer sources do.
        assert needle in html, name
        html = html.replace(needle, "")
        html = html.replace("</body>", "<script>\n" + script + "\n</script>\n</body>")
    html = html.replace('href="solve-trail-offline.zip"', 'href="SolveTrail.html"')
    html = html.replace('download="solve-trail-offline.zip"', 'download="SolveTrail.html"').replace('>Offline ZIP</a>', '>Save offline app</a>')
    assert "src=\"app.js\"" not in html and "fonts/plex-sans" not in html
    target = ROOT / "solve-trail-offline.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("SolveTrail.html", html)
        archive.writestr("README.txt", "Open SolveTrail.html in a browser. Logs stay on this device.\nSave/restore a private comparison JSON to continue with your own material.\nThe editable brief omits raw logs and file names by default.\nSource: https://github.com/blucca/blucca.github.io/tree/main/solve-trail\n")
        archive.write(ROOT / "LICENSE", "LICENSE")
        archive.write(ROOT / "fonts" / "OFL.txt", "font-OFL.txt")
    print(str(target) + ": " + str(target.stat().st_size) + " bytes; standalone HTML " + str(len(html.encode())) + " bytes")


if __name__ == "__main__":
    pack()
