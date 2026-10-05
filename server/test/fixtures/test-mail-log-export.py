import importlib.util
import pathlib
import subprocess
import tempfile
import types
import stat
import unittest.mock

path = pathlib.Path(__file__).resolve().parents[3] / "deploy/export-mail-logs.py"
spec = importlib.util.spec_from_file_location("export_mail_logs", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

lines, truncated = module.snapshot_lines(b"accepted\nAUTH secret\ncomplete\n")
assert lines == ["accepted", "[含认证或邮件内容的日志已隐藏]", "complete"]
assert not truncated
lines, truncated = module.snapshot_lines(("x" * 1200 + "\n" + "x" * 1200 + " password=never-output").encode())
assert truncated and len(lines[0]) == 1000 and "never-output" not in lines[1]
lines, truncated = module.snapshot_lines(b"partial\ncomplete\n", True)
assert lines == ["complete"] and truncated
lines, truncated = module.snapshot_lines(b"line\n" * 2001)
assert len(lines) == 2000 and truncated
payload = {"lines": ["\x00" * 1000] * 2000, "truncated": False}
assert len(module.encode_snapshot(payload)) <= module.MAX_SNAPSHOT_BYTES
assert payload["truncated"]
with unittest.mock.patch.object(module.subprocess, "Popen", return_value=subprocess.Popen(["/bin/sh", "-c", "printf 'not a valid export'; exit 1"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)):
    try:
        module.capture()
    except RuntimeError:
        pass
    else:
        raise AssertionError("failed capture was incorrectly accepted")
with tempfile.TemporaryDirectory(prefix="bakamail-log-export-test-") as directory:
    snapshot = pathlib.Path(directory) / "maddy.json"
    snapshot.write_text("previous sample")
    with unittest.mock.patch.object(module, "DIRECTORY", directory), \
         unittest.mock.patch.object(module.os, "geteuid", return_value=0), \
         unittest.mock.patch.object(module.os, "lstat", return_value=types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)), \
         unittest.mock.patch.object(module.subprocess, "check_output", return_value=b"foxcpp/maddy:0.9.5|true\n"), \
         unittest.mock.patch.object(module, "capture", side_effect=RuntimeError("capture failed")):
        try:
            module.main()
        except RuntimeError:
            pass
        else:
            raise AssertionError("failed capture accepted")
        assert snapshot.read_text() == "previous sample"
    with unittest.mock.patch.object(module, "DIRECTORY", directory), \
         unittest.mock.patch.object(module.os, "geteuid", return_value=0), \
         unittest.mock.patch.object(module.os, "lstat", return_value=types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)), \
         unittest.mock.patch.object(module.subprocess, "check_output", return_value=b"foxcpp/maddy:0.9.5|true\n"), \
         unittest.mock.patch.object(module, "capture", return_value=(["safe diagnostic line"], False)):
        module.main()
    payload = module.json.loads(snapshot.read_text())
    assert payload["lines"] == ["safe diagnostic line"] and payload["version"] == 1
    assert stat.S_IMODE(snapshot.stat().st_mode) == 0o600
    assert not list(pathlib.Path(directory).glob(".maddy-*"))
print("exporter checks passed")
