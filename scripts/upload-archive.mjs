import { createHash } from "node:crypto";

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

/** SSH exec fallback for a stalled SFTP channel; never print archive bytes. */
export function uploadArchiveByExec(bytes, destination, remote) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 16 * 1024 * 1024) throw new Error("发布包大小不受支持");
  if (!/^\/root\/mail\/backups\/bakamail-\d{8}T\d{6}Z\/release\.tar\.gz$/.test(destination)) throw new Error("发布包目标不匹配");
  const part = `${destination}.exec-part`;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const execute = (program) => remote(`python3 -c ${quote(program)}`);
  execute(`import os
fd=os.open(${JSON.stringify(part)},os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
os.close(fd)`);
  // Keep command arguments well below macOS/SSH argument-size limits.
  for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
    const chunk = bytes.subarray(offset, offset + 16 * 1024).toString("base64");
    execute(`import os,stat,base64
fd=os.open(${JSON.stringify(part)},os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)
with os.fdopen(fd,"ab") as output:
    info=os.fstat(output.fileno())
    assert stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and stat.S_IMODE(info.st_mode)==0o600
    assert info.st_size==${offset},"upload offset mismatch"
    output.write(base64.b64decode(${JSON.stringify(chunk)},validate=True))
    output.flush()
    os.fsync(output.fileno())`);
  }
  execute(`import os,stat,hashlib
part=${JSON.stringify(part)}
destination=${JSON.stringify(destination)}
with os.fdopen(os.open(part,os.O_RDONLY|os.O_NOFOLLOW),"rb") as source:
    info=os.fstat(source.fileno())
    assert stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and stat.S_IMODE(info.st_mode)==0o600
    assert info.st_size==${bytes.length},"upload size mismatch"
    assert hashlib.sha256(source.read()).hexdigest()==${JSON.stringify(digest)},"upload digest mismatch"
if os.path.lexists(destination):
    info=os.lstat(destination)
    assert stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid()
    failed=destination+".sftp-failed"
    assert not os.path.lexists(failed)
    os.rename(destination,failed)
os.rename(part,destination)`);
  return digest;
}
