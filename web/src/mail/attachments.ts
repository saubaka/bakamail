/** Cancel actual FileReader work as well as ignoring its late callbacks. */
export function readFileBase64(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const finish = (error?: Error, value = "") => {
      signal.removeEventListener("abort", cancel);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => {
      finish(new DOMException("附件读取已取消", "AbortError"));
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    reader.onload = () => {
      const result = String(reader.result);
      finish(undefined, result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => finish(new Error("读取附件失败"));
    reader.onabort = () => finish(new DOMException("附件读取已取消", "AbortError"));
    try { reader.readAsDataURL(file); } catch (error) {
      finish(error instanceof Error ? error : new Error("读取附件失败"));
    }
  });
}
