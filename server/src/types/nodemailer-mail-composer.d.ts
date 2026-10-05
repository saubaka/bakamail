// nodemailer 没有暴露 MailComposer 的类型，这里补一个最小声明。
declare module "nodemailer/lib/mail-composer/index.js" {
  export default class MailComposer {
    constructor(options: Record<string, unknown>);
    compile(): { build(callback?: (error: Error | null, message: Buffer) => void): Promise<Buffer> };
  }
}
