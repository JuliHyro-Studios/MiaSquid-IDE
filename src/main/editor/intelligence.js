const DECLARATION_PATTERNS = [
  ["javascript", /^\s*(?:(?:export|default|declare|abstract|async|public|private|protected|static)\s+)*(?:function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/, /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/],
  ["python", /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/],
  ["rust", /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/],
  ["go", /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/],
  ["csharp", /^\s*(?:(?:public|private|protected|internal|static|async|abstract|partial|virtual|override|sealed)\s+)*(?:class|interface|struct|enum|delegate)\s+([A-Za-z_]\w*)/],
  ["java", /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$]\w*)/]
];

const LANGUAGE_KEYWORDS = {
  javascript: "async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while yield",
  python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None not or pass raise return True try while with yield",
  rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  go: "break case chan const continue defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
  csharp: "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while",
  java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while",
  json: "true false null",
  css: "align-items background border color display flex grid height margin padding position width"
};

function languageForExtension(extension = "") {
  const languages = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "javascript", tsx: "javascript", py: "python", rs: "rust", go: "go",
    cs: "csharp", java: "java", json: "json", css: "css"
  };
  return languages[extension.toLowerCase()] || "javascript";
}

function declarationsForLine(line, language, lineNumber) {
  const matches = [];
  for (const [supported, ...patterns] of DECLARATION_PATTERNS) {
    if (supported !== language) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      const name = match?.[1] || match?.[2];
      if (name) {
        const kind = pattern.source.match(/(?:function|class|interface|type|enum|namespace|def|struct|trait|mod|func|record|delegate)/)?.[0] || "symbol";
        matches.push({ name, kind, line: lineNumber, column: line.indexOf(name) + 1 });
      }
    }
  }
  if (!matches.length && ["javascript", "python", "csharp", "java"].includes(language)) {
    const method = line.match(/^\s*(?:(?:public|private|protected|static|async|override|virtual|final|function)\s+)+[\w$<>\[\],?]+\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (method && !["if", "for", "while", "switch", "catch"].includes(method[1])) {
      matches.push({ name: method[1], kind: "method", line: lineNumber, column: line.indexOf(method[1]) + 1 });
    }
  }
  return matches;
}

function collectSymbols(content, language) {
  const symbols = [];
  content.split(/\r?\n/).forEach((line, index) => {
    symbols.push(...declarationsForLine(line, language, index + 1));
  });
  return symbols.filter((symbol, index) =>
    symbols.findIndex(item => item.line === symbol.line && item.name === symbol.name) === index);
}

function checkDelimiters(content, language) {
  const diagnostics = [];
  const stack = [];
  const opening = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);
  const closing = new Set(opening.values());
  let quote = null;
  let quoteStart = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let line = 1;
  let column = 0;

  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    const next = content[index + 1];
    column++;
    if (character === "\n") {
      line++;
      column = 0;
      if (language === "python" && quote && quote !== "`" && !escaped) {
        quote = null;
        quoteStart = null;
      }
      lineComment = false;
      escaped = false;
      continue;
    }
    if (lineComment) continue;
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index++;
        column++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) {
        quote = null;
        quoteStart = null;
      }
      continue;
    }
    if (character === "/" && next === "/" && language !== "python") {
      lineComment = true;
      index++;
      column++;
      continue;
    }
    if (character === "/" && next === "*" && language !== "python") {
      blockComment = true;
      index++;
      column++;
      continue;
    }
    if (character === "#" && language === "python") {
      lineComment = true;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      quoteStart = { line, column };
      continue;
    }
    if (opening.has(character)) {
      stack.push({ character, line, column });
    } else if (closing.has(character)) {
      const last = stack.pop();
      if (!last || opening.get(last.character) !== character) {
        diagnostics.push({ severity: "error", message: `Unexpected closing "${character}"`, line, column });
        if (last) stack.push(last);
      }
    }
  }
  for (const item of stack) {
    diagnostics.push({ severity: "error", message: `Unclosed "${item.character}"`, line: item.line, column: item.column });
  }
  if (quoteStart) diagnostics.push({ severity: "error", message: "Unterminated string literal", ...quoteStart });
  if (blockComment) diagnostics.push({ severity: "warning", message: "Unterminated block comment", line, column: Math.max(column, 1) });
  return diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function analyzeDocument(content, extension = "") {
  const language = languageForExtension(extension);
  let symbols = collectSymbols(content, language);
  const completionTokens = [...new Set(content.match(/[A-Za-z_$][\w$]*/g) || [])].slice(0, 10000);
  const diagnostics = checkDelimiters(content, language);
  const ast = { type: "Program", language, start: 0, end: content.length, body: [] };
  if (language === "javascript" && !["jsx", "tsx", "ts"].includes(extension.toLowerCase()) &&
      typeof window !== "undefined" && window.acorn) {
    let parsed;
    try {
      parsed = window.acorn.parse(content, { ecmaVersion: "latest", sourceType: "module", locations: true });
    } catch (moduleError) {
      try {
        parsed = window.acorn.parse(content, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, locations: true });
      } catch (scriptError) {
        diagnostics.push({
          severity: "error",
          message: scriptError.message,
          line: scriptError.loc?.line || moduleError.loc?.line || 1,
          column: (scriptError.loc?.column ?? moduleError.loc?.column ?? 0) + 1
        });
      }
    }
    if (parsed) {
      const declarationTypes = new Set([
        "Program", "BlockStatement", "FunctionDeclaration", "FunctionExpression",
        "ArrowFunctionExpression", "ClassDeclaration", "ClassExpression", "MethodDefinition",
        "VariableDeclaration", "VariableDeclarator", "ImportDeclaration",
        "ExportNamedDeclaration", "ExportDefaultDeclaration"
      ]);
      function compact(node, depth = 0) {
        if (!node || typeof node.type !== "string" || depth > 80) return null;
        const children = [];
        for (const [key, value] of Object.entries(node)) {
          if (key === "loc" || key === "start" || key === "end" || key === "type") continue;
          if (Array.isArray(value)) {
            for (const child of value) {
              if (child && typeof child.type === "string") {
                const compacted = compact(child, depth + 1);
                if (compacted) children.push(compacted);
              }
            }
          } else if (value && typeof value.type === "string") {
            const compacted = compact(value, depth + 1);
            if (compacted) children.push(compacted);
          }
        }
        if (!declarationTypes.has(node.type) && !children.length) return null;
        const name = node.id?.name || node.key?.name || node.key?.value ||
          (node.type === "VariableDeclarator" ? node.id?.name : undefined);
        return {
          type: node.type,
          ...(typeof name === "string" ? { name } : {}),
          start: node.start,
          end: node.end,
          line: node.loc?.start.line || 1,
          column: (node.loc?.start.column || 0) + 1,
          children
        };
      }
      ast.body = compact(parsed)?.children || [];
      const astSymbols = [];
      function collectAstSymbols(node) {
        if (node.name && ["FunctionDeclaration", "ClassDeclaration", "VariableDeclarator", "MethodDefinition"].includes(node.type)) {
          astSymbols.push({
            name: node.name,
            kind: node.type === "FunctionDeclaration" ? "function" :
              node.type === "ClassDeclaration" ? "class" :
                node.type === "MethodDefinition" ? "method" : "variable",
            line: node.line,
            column: node.column
          });
        }
        node.children.forEach(collectAstSymbols);
      }
      ast.body.forEach(collectAstSymbols);
      if (astSymbols.length) symbols = astSymbols;
    } else {
      ast.parseError = diagnostics.at(-1)?.message;
    }
  } else {
    ast.body = symbols.map(symbol => ({
      type: symbol.kind,
      name: symbol.name,
      start: content.split(/\r?\n/).slice(0, symbol.line - 1).join("\n").length + (symbol.line > 1 ? 1 : 0),
      end: content.split(/\r?\n/).slice(0, symbol.line).join("\n").length,
      line: symbol.line,
      column: symbol.column,
      children: []
    }));
  }
  return { language, ast, symbols, completionTokens, diagnostics };
}

const BUILTIN_MEMBERS = {
  console: "assert clear count countReset debug dir dirxml error group groupCollapsed groupEnd info log table time timeEnd timeLog trace warn",
  Math: "abs ceil floor max min random round sqrt pow trunc",
  JSON: "parse stringify",
  Array: "from isArray of",
  Object: "assign create entries freeze fromEntries hasOwn getOwnPropertyNames keys values",
  Promise: "all allSettled any race reject resolve",
  String: "fromCharCode fromCodePoint raw",
  Number: "isFinite isInteger isNaN parseFloat parseInt",
  document: "activeElement body createElement createTextNode getElementById querySelector querySelectorAll",
  window: "addEventListener close fetch location localStorage matchMedia removeEventListener setInterval setTimeout"
};

export function getCompletions(content, prefix, language, symbols = [], limit = 16, context = "", completionTokens = null) {
  if (typeof prefix !== "string") return [];
  const access = context.match(/([A-Za-z_$][\w$]*)\s*\.\s*$/);
  if (!prefix && !access) return [];
  if (access) {
    const objectName = access[1];
    const escapedName = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const members = BUILTIN_MEMBERS[objectName]?.split(" ") || [];
    const declarations = [...content.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${escapedName}\\s*=\\s*\\{([^{}]*)\\}`, "g"))];
    for (const declaration of declarations) {
      members.push(...[...declaration[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=:|\()/g)].map(match => match[1]));
    }
    if (members.length) {
      return [...new Set(members)]
        .filter(member => member.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))
        .sort((a, b) => Number(b.startsWith(prefix)) - Number(a.startsWith(prefix)) || a.localeCompare(b))
        .slice(0, limit);
    }
  }
  const words = Array.isArray(completionTokens)
    ? completionTokens
    : content.match(/[A-Za-z_$][\w$]*/g) || [];
  const keywordList = LANGUAGE_KEYWORDS[language] || LANGUAGE_KEYWORDS.javascript;
  const candidates = [...new Set([
    ...symbols.map(symbol => symbol.name),
    ...words,
    ...keywordList.split(" ")
  ])];
  return candidates
    .filter(word => word !== prefix && word.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))
    .sort((a, b) => {
      const aExact = a.startsWith(prefix);
      const bExact = b.startsWith(prefix);
      return Number(bExact) - Number(aExact) || a.localeCompare(b);
    })
    .slice(0, limit);
}

export { languageForExtension };
