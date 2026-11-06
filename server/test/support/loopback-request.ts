import http from "node:http";
import net from "node:net";
import supertest from "supertest";

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
