import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

function scanStringState(s, i, state) {
  const c = s[i];
  const next = s[i + 1];
  if (state.skipNext) {
    state.skipNext = false;
    return;
  }
  if (state.inLineComment) {
    if (c === '\n') state.inLineComment = false;
    return;
  }
  if (state.inBlockComment) {
    if (c === '*' && next === '/') {
      state.inBlockComment = false;
      state.i++;
    }
    return;
  }
  if (state.escape) {
    state.escape = false;
    return;
  }
  if (!state.inSingle && !state.inDouble && !state.inTemplate) {
    if (c === '/' && next === '/') {
      state.inLineComment = true;
      state.i++;
      return;
    }
    if (c === '/' && next === '*') {
      state.inBlockComment = true;
      state.i++;
      return;
    }
  }
  if (state.inSingle) {
    if (c === '\\') state.escape = true;
    else if (c === "'") state.inSingle = false;
    return;
  }
  if (state.inDouble) {
    if (c === '\\') state.escape = true;
    else if (c === '"') state.inDouble = false;
    return;
  }
  if (state.inTemplateExpr > 0) {
    if (c === '(') state.inTemplateExpr++;
    else if (c === ')') state.inTemplateExpr--;
    else if (c === '}') state.inTemplateExpr--;
    return;
  }
  if (state.inTemplate) {
    if (c === '\\') state.escape = true;
    else if (c === '$' && next === '{') {
      state.inTemplateExpr = 1;
      state.skipNext = true;
      return;
    } else if (c === '`') state.inTemplate = false;
    return;
  }
  if (c === "'") {
    state.inSingle = true;
    return;
  }
  if (c === '"') {
    state.inDouble = true;
    return;
  }
  if (c === '`') {
    state.inTemplate = true;
  }
}

function findMatchingParen(s, openIdx) {
  let depth = 0;
  const state = {
    inSingle: false,
    inDouble: false,
    inTemplate: false,
    inTemplateExpr: 0,
    inLineComment: false,
    inBlockComment: false,
    escape: false,
    skipNext: false,
    i: 0,
  };
  for (let i = openIdx; i < s.length; i++) {
    state.i = i;
    const c = s[i];
    scanStringState(s, i, state);
    const inLiteral =
      state.inSingle ||
      state.inDouble ||
      state.inTemplate ||
      state.inTemplateExpr > 0 ||
      state.inLineComment ||
      state.inBlockComment;
    if (inLiteral) continue;
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelComma(s) {
  const parts = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  const state = {
    inSingle: false,
    inDouble: false,
    inTemplate: false,
    inTemplateExpr: 0,
    inLineComment: false,
    inBlockComment: false,
    escape: false,
    skipNext: false,
    i: 0,
  };
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    state.i = i;
    const c = s[i];
    scanStringState(s, i, state);
    const inLiteral =
      state.inSingle ||
      state.inDouble ||
      state.inTemplate ||
      state.inTemplateExpr > 0 ||
      state.inLineComment ||
      state.inBlockComment;
    if (inLiteral) continue;
    if (c === '(') depthParen++;
    else if (c === ')') depthParen--;
    else if (c === '{') depthBrace++;
    else if (c === '}') depthBrace--;
    else if (c === '[') depthBracket++;
    else if (c === ']') depthBracket--;
    else if (c === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function migrateToolCall(content, match) {
  const toolIdx = match.index + match[0].lastIndexOf('tool');
  const openIdx = content.indexOf('(', toolIdx);
  if (openIdx === -1) return null;
  const closeIdx = findMatchingParen(content, openIdx);
  if (closeIdx === -1) return null;
  const inner = content.slice(openIdx + 1, closeIdx);
  const commaSplit = splitTopLevelComma(inner);
  if (commaSplit.length < 2) return null;
  const executePart = commaSplit[0];
  const optionsPart = commaSplit.slice(1).join(',').replace(/,\s*$/, '');
  const execute = executePart.trim();
  const options = optionsPart.trim();
  if (!execute.startsWith('async')) return null;
  const funcBody = execute.replace(/^async\s*/, '');
  const optionsInner = options.replace(/^\{/, '').replace(/\}\s*,?\s*$/, '').trim();
  const varMatch = match[0].match(/(?:export )?const (\w+) = /);
  const varName = varMatch?.[1] ?? 'unknownTool';
  const exportPrefix = match[0].startsWith('export') ? 'export ' : '';
  const replacement = `${exportPrefix}const ${varName} = defineTool({\n  ${optionsInner},\n  execute: async ${funcBody},\n});`;
  return { start: match.index, end: closeIdx + 1, replacement };
}

function migrateDynamicStructuredTool(content, startIdx) {
  const openIdx = content.indexOf('({', startIdx);
  if (openIdx === -1) return null;
  const braceStart = openIdx + 1;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;
  let braceEnd = -1;
  for (let i = braceStart; i < content.length; i++) {
    const c = content[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inSingle) {
      if (c === '\\') escape = true;
      else if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '\\') escape = true;
      else if (c === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (c === '\\') escape = true;
      else if (c === '`') inTemplate = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === '`') {
      inTemplate = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }
  if (braceEnd === -1) return null;
  const closeParen = content.indexOf(')', braceEnd);
  if (closeParen === -1) return null;
  const inner = content.slice(braceStart + 1, braceEnd);
  const migrated = inner.replace(/\bfunc\s*:/g, 'execute:');
  const replacement = `defineTool({${migrated}})`;
  return { start: startIdx, end: closeParen + 1, replacement };
}

function relativeDefineToolImport(filePath) {
  const rel = path.relative(path.dirname(filePath), path.join(ROOT, 'src', 'runtime'));
  const normalized = rel.split(path.sep).join('/');
  return normalized.startsWith('.') ? `${normalized}/tools` : `./${normalized}/tools`;
}

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const hadLangchainTools =
    content.includes('@langchain/core/tools') ||
    content.includes('DynamicStructuredTool') ||
    /\btool\s*\(/.test(content);
  if (!hadLangchainTools) return false;

  const importPath = relativeDefineToolImport(filePath);
  const needsType = /DynamicStructuredTool/.test(content);

  if (content.includes("import { tool } from '@langchain/core/tools'")) {
    content = content.replace(
      /import \{ tool \} from ['"]@langchain\/core\/tools['"];\r?\n/g,
      `import { defineTool } from '${importPath}';\n`,
    );
  }
  if (content.includes('DynamicStructuredTool')) {
    const typePart = needsType ? ', type ToolDefinition' : '';
    content = content.replace(
      /import \{ DynamicStructuredTool \} from ['"]@langchain\/core\/tools['"];\r?\n/g,
      `import { defineTool${typePart} } from '${importPath}';\n`,
    );
  }

  let changed = true;
  while (changed) {
    changed = false;
    const toolMatch = content.match(/(?:export const|const) \w+ = tool\s*\(/);
    if (toolMatch) {
      const m = migrateToolCall(content, toolMatch);
      if (m) {
        content = content.slice(0, m.start) + m.replacement + content.slice(m.end);
        changed = true;
        continue;
      }
      console.warn(`[migrate] failed tool() in ${filePath} at ${toolMatch.index}`);
    }
    const dynMatch = content.match(/new\s+DynamicStructuredTool\s*\(/);
    if (dynMatch && dynMatch.index !== undefined) {
      const m = migrateDynamicStructuredTool(content, dynMatch.index);
      if (m) {
        content = content.slice(0, m.start) + m.replacement + content.slice(m.end);
        changed = true;
      }
    }
  }

  content = content.replace(/DynamicStructuredTool\[\]/g, 'ToolDefinition[]');
  content = content.replace(/Record<string, DynamicStructuredTool>/g, 'Record<string, ToolDefinition>');
  content = content.replace(/: DynamicStructuredTool\b/g, ': ToolDefinition');
  content = content.replace(/\bDynamicStructuredTool\b/g, 'ToolDefinition');
  content = content.replace(/obj is ToolDefinition/g, 'obj is ToolDefinition');

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

const files = process.argv.slice(2);
for (const f of files) {
  const abs = path.isAbsolute(f) ? f : path.join(ROOT, f);
  if (migrateFile(abs)) {
    console.log('migrated:', f);
  }
}
