import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/** Source-only inventory; no network, database, message content, or credential reads. */
export function collectNotificationDisplayInventory(root = projectRoot) {
  const sites = [];
  function scanScript(content, file, startLine = 1) {
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const bindings = new Map();
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const from = node.moduleSpecifier.text;
      if (!/(?:^|\/)(?:notifications|api)(?:\.ts)?$/.test(from)) continue;
      const named = node.importClause?.namedBindings;
      if (!named || !ts.isNamedImports(named)) continue;
      for (const binding of named.elements) {
        const exported = (binding.propertyName ?? binding.name).text;
        if (['notify', 'toast', 'beginProgressNotice'].includes(exported)) bindings.set(binding.name.text, exported);
      }
    }
    // The notification module's own async-action error calls its exported notify function.
    if (file === 'web/src/notifications.ts') bindings.set('notify', 'notify');
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && bindings.has(node.expression.text)) {
        const name = bindings.get(node.expression.text);
        const options = node.arguments[name === 'beginProgressNotice' ? 1 : 2]?.getText(ast) ?? '';
        const toneArg = node.arguments[1];
        const tone = name === 'beginProgressNotice' ? 'loading'
          : !toneArg ? 'success' : ts.isStringLiteral(toneArg) ? toneArg.text : 'dynamic';
        sites.push({ file, line: startLine + ast.getLineAndCharacterOfPosition(node.getStart(ast)).line,
          kind: name === 'beginProgressNotice' ? 'progress' : name, tone,
          persistent: /\bpersistent\s*:\s*true\b/.test(options), action: /\baction\s*:/.test(options),
          manualReason: options.match(/\bmanualReason\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null,
          preview: /\bpreviewConfig\b/.test(options) });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name)) continue;
      const file = relative(root, path).split('\\').join('/'), content = readFileSync(path, 'utf8');
      if (entry.name.endsWith('.ts')) { scanScript(content, file); continue; }
      const { descriptor, errors } = parseSfc(content, { filename: file });
      if (errors.length) throw new Error(`Cannot inventory invalid Vue component: ${file}`);
      for (const script of [descriptor.script, descriptor.scriptSetup]) if (script) scanScript(script.content, file, script.loc.start.line);
      const template = descriptor.template;
      if (!template) continue;
      function visitTemplate(node) {
        if (node.type === 1) for (const prop of node.props) {
          if (prop.type !== 7 || prop.name !== 'capsule-notice') continue;
          const options = prop.exp?.content ?? '';
          sites.push({ file, line: template.loc.start.line + prop.loc.start.line - 1, kind: 'directive', tone: /\btone\s*:/.test(options) ? 'dynamic' : 'error',
            persistent: /\bpersistent\s*:\s*true\b/.test(options), action: /\baction\s*:/.test(options), preview: false });
          sites.at(-1).manualReason = options.match(/\bmanualReason\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null;
        }
        for (const child of node.children ?? []) visitTemplate(child);
      }
      visitTemplate(baseParse(template.content));
    }
  }
  walk(resolve(root, 'web/src'));
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sites = collectNotificationDisplayInventory();
  if (process.argv.includes('--summary')) {
    const byFile = new Map();
    for (const site of sites) {
      const row = byFile.get(site.file) ?? { toast: 0, notify: 0, progress: 0, directive: 0 };
      row[site.kind]++; byFile.set(site.file, row);
    }
    console.log(JSON.stringify({ total: sites.length, files: [...byFile].map(([file, counts]) => ({ file, ...counts })),
      persistent: sites.filter(site => site.persistent), manualExceptions: sites.filter(site => site.manualReason), progress: sites.filter(site => site.kind === 'progress') }, null, 2));
  } else console.log(JSON.stringify(sites, null, 2));
}
