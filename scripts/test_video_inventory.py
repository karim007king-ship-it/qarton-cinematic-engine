#!/usr/bin/env python3
"""Smoke-test video history inventory in an isolated temporary Git repository."""
import csv
import os
import pathlib
import subprocess
import tempfile

SCRIPT=pathlib.Path(__file__).with_name("inventory_video_history.py").resolve()
def run(*args, cwd, env=None):
    return subprocess.run(args,cwd=cwd,env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory)
    run("git","init","-q",cwd=root)
    run("git","config","user.name","QARTON Audit",cwd=root)
    run("git","config","user.email","audit@example.invalid",cwd=root)
    video=root/"sample clip.mp4"
    video.write_bytes(b"video fixture v1")
    run("git","add",".",cwd=root)
    run("git","commit","-qm","add fixture",cwd=root)
    run("git","branch","archive",cwd=root)
    video.unlink()
    run("git","add","-A",cwd=root)
    run("git","commit","-qm","remove fixture",cwd=root)
    env=dict(os.environ,GITHUB_REPOSITORY="example/fixture")
    run("python3",str(SCRIPT),cwd=root,env=env)
    with (root/"video-inventory-all-refs.csv").open(newline="",encoding="utf-8") as stream:
        rows=list(csv.DictReader(stream))
    assert len(rows)==1, rows
    assert rows[0]["path"]=="sample clip.mp4", rows
    assert rows[0]["source"]=="git_history_only", rows
print("Video history inventory smoke test passed")
