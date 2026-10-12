import http from "node:http";
import net from "node:net";
import supertest from "supertest";

/**
 * supertest 默认用 app.listen(0)（监听全部地址），却用 127.0.0.1 去连。macOS 允许“通配地址”和
 * “127.0.0.1 专用地址”在同一端口共存，而连接会优先到达专用地址的监听者：同一台电脑上别的程序
 * 如果恰好在临时端口范围里占着 127.0.0.1:某端口，而测试又恰好分到同一个端口，请求就被别的程序
 * 应答（404 的网页、空内容……），表现为完整测试偶发失败。
 * 这里让测试服务器同样只监听 127.0.0.1，内核在同一地址上会拒绝已占用的端口，也就不会撞车。
 *
 * supertest 在 listen(0) 之后立刻读取端口，而带地址的 listen 要先做异步解析，端口不能同步拿到，
 * 所以先同步创建绑定在 127.0.0.1 的监听句柄，再交给服务器。
 */
type ServerHandleFactory = (address: string, port: number, family: number) => object | number;
const createServerHandle = (net as unknown as { _createServerHandle: ServerHandleFactory })._createServerHandle;

function loopbackServer(app: unknown): unknown {
  if (typeof app !== "function") return app;
  const server = http.createServer(app as http.RequestListener);
  const listen = server.listen.bind(server) as (...args: unknown[]) => http.Server;
  (server as unknown as { listen: (...args: unknown[]) => http.Server }).listen = (...args: unknown[]) => {
    const handle = createServerHandle("127.0.0.1", 0, 4);
    if (typeof handle === "number") throw new Error(`无法在 127.0.0.1 上创建测试服务器（错误码 ${handle}）`);
    return listen(handle, ...args.slice(1));
  };
  return server;
}

type Request = ((app: unknown) => ReturnType<typeof supertest>) & { agent: (app?: unknown, options?: object) => ReturnType<typeof supertest.agent> };

const request = ((app: unknown) => supertest(loopbackServer(app) as never)) as Request;
request.agent = (app?: unknown, options?: object) => supertest.agent(loopbackServer(app) as never, options as never);

export default request;
