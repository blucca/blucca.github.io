"""Resolve the working shelf, then request three real Qloo shortlist rankings."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID


INPUT = Path(__file__).with_name("coverage-input.json")
BASE = "https://hackathon.api.qloo.com"


def inputs():
    data = json.loads(INPUT.read_text())
    items = data["films"] + [item for group in data["anchors"].values() for item in group]
    assert len(data["films"]) == 12 and len(items) == 21
    assert len({item["slug"] for item in items}) == len(items)
    assert set(data["anchors"]) == {"regular_cinema", "book_club", "record_shop"}
    assert all(len(group) == 3 for group in data["anchors"].values())
    return data, items


def requests_for(stage, data, items, identities):
    if stage == "search":
        return [("search-" + item["slug"], "/search", {
            "query": item["name"], "types": item["entity_type"], "take": 5,
        }) for item in items]

    if not isinstance(identities, dict) or any(
            value is not None and not isinstance(value, str) for value in identities.values()):
        raise ValueError("Identity map values must be UUID strings or null.")
    known = {item["slug"] for item in items}
    if set(identities) - known:
        raise ValueError("Identity map contains slugs outside the working shelf.")
    ids = {slug: str(UUID(value)).upper() for slug, value in identities.items() if value}
    if len(set(ids.values())) != len(ids):
        raise ValueError("Assign a distinct, identity-checked entity to each input.")
    films = [ids[item["slug"]] for item in data["films"] if item["slug"] in ids]
    if len(films) < 10:
        raise ValueError("The coverage gate requires at least 10 identity-checked films.")
    queries = []
    for group, anchors in data["anchors"].items():
        missing = [item["slug"] for item in anchors if item["slug"] not in ids]
        if missing:
            raise ValueError("Resolve the remaining anchors: " + ", ".join(missing))
        queries.append(("insights-" + group, "/v2/insights", {
            "filter.type": "urn:entity:movie",
            "filter.results.entities": ",".join(films),
            "signal.interests.entities": ",".join(ids[item["slug"]] for item in anchors),
            "bias.trends": "off", "take": len(films),
        }))
    return queries


def check():
    data, items = inputs()
    searches = requests_for("search", data, items, {})
    ids = {item["slug"]: str(UUID(int=i + 1)) for i, item in enumerate(items)}
    ranks = requests_for("insights", data, items, ids)
    assert len(searches) == 21 and all(path == "/search" for _, path, _ in searches)
    assert {p["types"] for _, _, p in searches} == {
        "urn:entity:movie", "urn:entity:book", "urn:entity:artist"}
    assert len(ranks) == 3 and len({p["filter.results.entities"] for _, _, p in ranks}) == 1
    assert len({p["signal.interests.entities"] for _, _, p in ranks}) == 3
    assert all(len(p["filter.results.entities"].split(",")) == p["take"] == 12
               for _, _, p in ranks)
    for item in data["films"][:3]:
        ids[item["slug"]] = None
    try:
        requests_for("insights", data, items, ids)
    except ValueError:
        pass
    else:
        raise AssertionError("The ten-film guard failed.")
    print("Input and query-shape check passed: 12 films, 9 anchors, 0 live API calls.")


def run(args):
    data, items = inputs()
    identities = json.loads(args.ids.read_text()) if args.ids else {}
    queries = requests_for(args.stage, data, items, identities)
    key = os.environ.get("QLOO_API_KEY", "").strip()
    if not key:
        raise ValueError("Set QLOO_API_KEY in the process environment.")
    if args.out is None:
        raise ValueError("Choose a private output directory with --out.")
    out = args.out.resolve()
    source = Path(__file__).resolve()
    repo = next((p for p in source.parents if (p / ".git").exists()), source.parent)
    if out.is_relative_to(repo):
        raise ValueError("Choose an output directory outside this published repository.")
    os.umask(0o077)
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    out.chmod(0o700)
    if args.stage == "search" and not (out / "entity-ids.json").exists():
        (out / "entity-ids.json").write_text(json.dumps(
            {item["slug"]: None for item in items}, indent=2) + "\n")
    for name, path, params in queries:
        destination = out / (name + ".json")
        if destination.exists():
            saved = json.loads(destination.read_text())
            if saved.get("path") != path or saved.get("params") != params:
                raise ValueError("Inputs changed; choose a fresh --out directory.")
            if saved.get("http_status") != 200 or saved.get("response", {}).get("success") is not True:
                raise ValueError("Review the incomplete saved response: " + str(destination))
            print("Saved response:", destination)
            continue
        request = Request(BASE + path + "?" + urlencode(params),
                          headers={"X-Api-Key": key, "Accept": "application/json"})
        try:
            response = urlopen(request, timeout=30)
        except HTTPError as error:
            response = error
        with response:
            status = response.status
            body = response.read().decode("utf-8")
        try:
            payload = json.loads(body)
        except ValueError:
            payload = {"raw_body": body}
        ok = status == 200 and isinstance(payload, dict) and payload.get("success") is True
        record = {"at": datetime.now(timezone.utc).isoformat(), "base": BASE,
                  "path": path, "params": params, "http_status": status, "response": payload}
        if not ok:
            destination = out / (name + "-failure-" + str(time.time_ns()) + ".json")
        destination.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
        print("Saved response:", destination)
        if not ok:
            raise ValueError(f"Request stopped at HTTP {status}; inspect the private response.")
        time.sleep(1)
    print("Review the saved identities or rankings against the coverage protocol.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("check", "search", "insights"))
    parser.add_argument("--out", type=Path)
    parser.add_argument("--ids", type=Path)
    args = parser.parse_args()
    try:
        check() if args.stage == "check" else run(args)
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + "\n")
