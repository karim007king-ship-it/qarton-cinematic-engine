#!/usr/bin/env python3
"""Read-only inventory of video blobs across fetched Git refs."""
import csv
import hashlib
import pathlib
import subprocess
from collections import defaultdict

EXTS={".mp4",".webm",".mov",".m4v",".avi",".mkv",".ogv",".wmv",".mpeg",".mpg"}
def git(*args):
    return subprocess.check_output(["git",*args],stderr=subprocess.DEVNULL)
def main():
    entries=git("rev-list","--objects","--all").decode("utf-8","surrogateescape").splitlines()
    by_oid=defaultdict(set)
    for line in entries:
        oid,_,path=line.partition(" ")
        if path and pathlib.PurePosixPath(path).suffix.lower() in EXTS:
            by_oid[oid].add(path)
    rows=[]
    for oid,paths in sorted(by_oid.items()):
        if git("cat-file","-t",oid).strip()!=b"blob":continue
        data=git("cat-file","blob",oid)
        digest=hashlib.sha256(data).hexdigest()
        for path in sorted(paths):
            rows.append(dict(path=path,bytes=len(data),sha256=digest,git_blob_oid=oid,source="git_history",github_url=""))
    # Record current branch separately so references are explicit.
    tracked=git("ls-files","-z").decode("utf-8","surrogateescape").split("\0")
    current={p for p in tracked if p and pathlib.PurePosixPath(p).suffix.lower() in EXTS}
    for row in rows:
        if row["path"] in current:
            row["source"]="git_history;current_checkout"
    fields=["path","bytes","sha256","git_blob_oid","source","github_url"]
    with open("video-inventory-all-refs.csv","w",encoding="utf-8",newline="") as out:
        w=csv.DictWriter(out,fieldnames=fields);w.writeheader();w.writerows(rows)
    groups=defaultdict(list)
    for row in rows:groups[row["sha256"]].append(row["path"])
    duplicates={k:sorted(set(v)) for k,v in groups.items() if len(set(v))>1}
    with open("video-inventory-all-refs.md","w",encoding="utf-8") as out:
        out.write("# QARTON video inventory — all fetched refs\n\n")
        out.write(f"Historical video path/blob records: {len(rows)}\n\n")
        out.write(f"Distinct video hashes: {len(groups)}\n\n")
        out.write(f"Duplicate hash groups (different paths): {len(duplicates)}\n\n")
        for row in rows:
            out.write(f'- `{row["path"]}` — {row["bytes"]} bytes — SHA256 `{row["sha256"]}` — blob `{row["git_blob_oid"]}` — {row["source"]}\n')
        out.write("\n## Identical content at different paths\n\n")
        for digest,paths in duplicates.items():
            out.write(f"- SHA256 `{digest}`: "+", ".join(f"`{p}`" for p in paths)+"\n")
        out.write("\nRead-only audit. Includes fetched Git refs only; deleted/unreachable objects, external release assets, Git LFS payloads, and other repositories are not covered. No files were deleted.\n")
    print(f"Historical records: {len(rows)}, unique hashes: {len(groups)}, duplicate groups: {len(duplicates)}")
if __name__=="__main__":main()
