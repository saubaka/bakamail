#!/usr/bin/env python3
"""Root-side, bounded log export. The web container gets only a read-only snapshot."""
import datetime
import fcntl
import json
import os
import re
import selectors
import stat
import subprocess
import tempfile
import time

CONTAINER = os.environ.get("MADDY_CONTAINER", "maddy")
DIRECTORY = os.environ.get("MAIL_LOG_DIRECTORY", "/root/mail/bakamail-mail-logs")
MAX_BYTES = 2_000_000
MAX_SNAPSHOT_BYTES = 2_500_000
SENSITIVE = re.compile(r"password|passwd|credential|secret|token|authorization|\bauth\b|\b(?:body|subject|message-data)\s*[:=]", re.I)


def snapshot_lines(raw, was_truncated=False):
    lines = raw.decode("utf-8", errors="replace").splitlines()
    if was_truncated and lines:
        lines = lines[1:]  # discard the partially retained first line
    truncated = was_truncated or len(lines) > 2000 or any(len(line) > 1000 for line in lines)
    safe = ["[含认证或邮件内容的日志已隐藏]" if SENSITIVE.search(line) else line[:1000] for line in lines[-2000:]]
    return safe, truncated


def capture():
    child = subprocess.Popen(["docker", "logs", "--timestamps", "--tail", "2000", CONTAINER], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 20
    output = bytearray()
    truncated = False
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("capture timeout")
            for key, _ in selector.select(min(remaining, 1)):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                output.extend(chunk)
                if len(output) > MAX_BYTES:
                    del output[:-MAX_BYTES]
                    truncated = True
        if child.wait(timeout=max(0.1, deadline - time.monotonic())) != 0:
            raise RuntimeError("capture failed")
        return snapshot_lines(output, truncated)
    finally:
        selector.close()
        if child.poll() is None:
            child.kill()
        child.wait()
        child.stdout.close()


def encode_snapshot(payload):
    while True:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if len(encoded) <= MAX_SNAPSHOT_BYTES:
            return encoded
        # Escaped control characters can inflate JSON beyond the raw capture bound.
        payload["lines"] = payload["lines"][max(1, len(payload["lines"]) // 2):]
        payload["truncated"] = True


def main():
    if os.geteuid() != 0:
        raise RuntimeError("root required")
    # Deployment creates this directory. Refuse unexpected ownership or symlinks.
    info = os.lstat(DIRECTORY)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError("unsafe snapshot directory")
    lock = os.open(DIRECTORY + "/export.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        identity = subprocess.check_output(["docker", "inspect", "--format", "{{.Config.Image}}|{{.State.Running}}", CONTAINER], timeout=5).decode().strip()
        if identity != "foxcpp/maddy:0.9.5|true":
            raise RuntimeError("mail container identity mismatch")
        lines, truncated = capture()
        payload = {"version": 1, "container": CONTAINER, "source": "docker-logs", "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "lines": lines, "truncated": truncated}
        fd, temporary = tempfile.mkstemp(prefix=".maddy-", dir=DIRECTORY)
        try:
            with os.fdopen(fd, "wb") as file:
                file.write(encode_snapshot(payload))
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, DIRECTORY + "/maddy.json")
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not print raw subprocess output or overwrite the last successful sample.
        raise SystemExit("mail log export failed; previous snapshot preserved")
