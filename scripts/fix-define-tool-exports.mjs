import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

function snakeToToolExport(name) {
  const camel = name.replace(/_([a-z0-9])/gi, (_, c) => c.toUpperCase());
  return `${camel}Tool`;
}

function repairFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  content = content.replace(/\}\),,/g, '}),');
  content = content.replace(/z\.object\(\{\}\),,/g, 'z.object({}),');

  content = content.replace(
    /^defineTool\(\{\s*\n(\s*name:\s*['"]([^'"]+)['"])/gm,
    (_, nameLine, toolName) => {
      const exportName = snakeToToolExport(toolName);
      return `export const ${exportName} = defineTool({\n${nameLine}`;
    },
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('repaired:', path.relative(ROOT, filePath));
  }
}

const files = process.argv.slice(2);
for (const f of files) {
  repairFile(path.isAbsolute(f) ? f : path.join(ROOT, f));
}
