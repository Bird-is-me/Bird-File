const TOKEN_PATTERN = /\s*(?:(\d+(?:\.\d+)?)|("(?:\\.|[^"\\])*")|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|[()[\],.+\-*/<>!=]))/y;

function tokenize(source, lineNumber) {
  const tokens = [];
  let position = 0;
  const input = source.trim();

  while (position < input.length) {
    TOKEN_PATTERN.lastIndex = position;
    const match = TOKEN_PATTERN.exec(input);
    if (!match) throw new Error(`Line ${lineNumber}: Invalid token near "${input.slice(position)}".`);
    position = TOKEN_PATTERN.lastIndex;

    if (match[1]) tokens.push({ type: "number", value: Number(match[1]) });
    else if (match[2]) tokens.push({ type: "string", value: JSON.parse(match[2]) });
    else if (match[3]) tokens.push({ type: "identifier", value: match[3] });
    else tokens.push({ type: "operator", value: match[4] });
  }

  return tokens;
}

async function evaluateExpression(source, variables, lineNumber, runtime) {
  const tokens = tokenize(source, lineNumber);
  let position = 0;

  async function primary() {
    const token = tokens[position++];
    if (!token) throw new Error(`Line ${lineNumber}: Expected a value.`);
    if (token.type === "number" || token.type === "string") return token.value;
    if (token.type === "operator" && token.value === "[") {
      const values = [];
      while (tokens[position]?.value !== "]") {
        values.push(await disjunction());
        if (tokens[position]?.value !== ",") break;
        position += 1;
      }
      if (tokens[position++]?.value !== "]") throw new Error(`Line ${lineNumber}: Expected "]" after list values.`);
      return values;
    }
    if (token.type === "identifier") {
      if (token.value === "True") return true;
      if (token.value === "False") return false;
      if (token.value === "input") {
        if (tokens[position++]?.value !== "(") throw new Error(`Line ${lineNumber}: Use input("prompt").`);
        const prompt = await addition();
        if (tokens[position++]?.value !== ")") throw new Error(`Line ${lineNumber}: Expected ")" after input prompt.`);
        if (typeof prompt !== "string") throw new Error(`Line ${lineNumber}: input() prompt must be a string.`);
        if (!runtime.readInput) throw new Error(`Line ${lineNumber}: input() requires an interactive Terminal Input handler.`);
        return runtime.readInput(prompt, lineNumber);
      }
      if (["e", "v"].includes(token.value) && tokens[position]?.value === ".") {
        position += 1;
        const name = tokens[position++];
        if (name?.type !== "identifier" || !variables.has(name.value)) {
          throw new Error(`Line ${lineNumber}: Unknown typed value "${name?.value ?? ""}".`);
        }
        const variable = variables.get(name.value);
        if (token.value === "v" && (!Array.isArray(variable.value) || variable.declaredType !== "v")) {
          throw new Error(`Line ${lineNumber}: "${name.value}" is not a v list.`);
        }
        return applyIndexes(variable.value);
      }
      if (!variables.has(token.value)) throw new Error(`Line ${lineNumber}: Unknown variable "${token.value}".`);
      const variable = variables.get(token.value);
      if (tokens[position]?.value !== ".") {
        const selector = variable.type === "number" ? "r" : "s";
        throw new Error(`Line ${lineNumber}: Variable "${token.value}" needs a type selector. Use "${token.value}.${selector}".`);
      }
      position += 1;
      const typeToken = tokens[position++];
      const expectedType = typeToken?.value === "r" ? "number" : typeToken?.value === "s" ? "string" : null;
      if (!expectedType) throw new Error(`Line ${lineNumber}: Use ".r" for numbers or ".s" for strings.`);
      if (variable.type !== expectedType) {
        throw new Error(`Line ${lineNumber}: Variable "${token.value}" is ${variable.type}, not ${expectedType}.`);
      }
      return applyIndexes(variable.value);
    }
    if (token.value === "(") {
      const value = await addition();
      if (tokens[position++]?.value !== ")") throw new Error(`Line ${lineNumber}: Expected ")".`);
      return value;
    }
    throw new Error(`Line ${lineNumber}: Expected a value.`);
  }

  async function applyIndexes(value) {
    while (tokens[position]?.value === "[") {
      position += 1;
      const index = await disjunction();
      if (tokens[position++]?.value !== "]") throw new Error(`Line ${lineNumber}: Expected "]" after list index.`);
      if (!Array.isArray(value)) throw new Error(`Line ${lineNumber}: Indexing requires a list.`);
      if (!Number.isInteger(index)) throw new Error(`Line ${lineNumber}: List index must be an integer.`);
      if (index < 0 || index >= value.length) throw new Error(`Line ${lineNumber}: List index is out of range.`);
      value = value[index];
    }
    return value;
  }

  async function unary() {
    if (tokens[position]?.value === "-") {
      position += 1;
      const value = await unary();
      if (typeof value !== "number") throw new Error(`Line ${lineNumber}: Unary minus requires a number.`);
      return -value;
    }
    if (tokens[position]?.type === "identifier" && tokens[position].value === "not") {
      position += 1;
      const value = await unary();
      if (typeof value !== "boolean") throw new Error(`Line ${lineNumber}: not requires a boolean.`);
      return !value;
    }
    return primary();
  }

  async function multiplication() {
    let value = await unary();
    while (["*", "/"].includes(tokens[position]?.value)) {
      const operator = tokens[position++].value;
      const right = await unary();
      if (typeof value !== "number" || typeof right !== "number") {
        throw new Error(`Line ${lineNumber}: ${operator} requires numbers.`);
      }
      if (operator === "/" && right === 0) throw new Error(`Line ${lineNumber}: Cannot divide by zero.`);
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  async function addition() {
    let value = await multiplication();
    while (["+", "-"].includes(tokens[position]?.value)) {
      const operator = tokens[position++].value;
      const right = await multiplication();
      if (operator === "+" && (typeof value === "string" || typeof right === "string")) {
        value = String(value) + String(right);
      } else {
        if (typeof value !== "number" || typeof right !== "number") {
          throw new Error(`Line ${lineNumber}: ${operator} requires numbers.`);
        }
        value = operator === "+" ? value + right : value - right;
      }
    }
    return value;
  }

  async function comparison() {
    const left = await addition();
    const operator = tokens[position]?.value;
    if (!["==", "!=", "<", ">", "<=", ">="].includes(operator)) return left;
    position += 1;
    const right = await addition();
    if (operator === "==") return typeof left === typeof right && left === right;
    if (operator === "!=") return typeof left !== typeof right || left !== right;
    if (typeof left !== typeof right || !["number", "string"].includes(typeof left)) {
      throw new Error(`Line ${lineNumber}: ${operator} requires two numbers or two strings.`);
    }
    if (operator === "<") return left < right;
    if (operator === ">") return left > right;
    if (operator === "<=") return left <= right;
    return left >= right;
  }

  async function conjunction() {
    let value = await comparison();
    while (tokens[position]?.type === "identifier" && tokens[position].value === "and") {
      position += 1;
      const right = await comparison();
      if (typeof value !== "boolean" || typeof right !== "boolean") throw new Error(`Line ${lineNumber}: and requires boolean values.`);
      value = value && right;
    }
    return value;
  }

  async function disjunction() {
    let value = await conjunction();
    while (tokens[position]?.type === "identifier" && tokens[position].value === "or") {
      position += 1;
      const right = await conjunction();
      if (typeof value !== "boolean" || typeof right !== "boolean") throw new Error(`Line ${lineNumber}: or requires boolean values.`);
      value = value || right;
    }
    return value;
  }

  const value = await disjunction();
  if (position !== tokens.length) throw new Error(`Line ${lineNumber}: Unexpected token "${tokens[position].value}".`);
  return value;
}

export async function runBirdProgram(source, options = {}) {
  const variables = new Map();
  const functions = new Map();
  const output = [];
  const lines = source.split(/\r?\n/);
  const sourceLines = lines.map((raw, index) => ({
    raw,
    statement: raw.trim(),
    indent: raw.match(/^\s*/)[0].length,
    lineNumber: index + 1,
  }));
  let sourceIndex = 0;
  const runtime = {
    readInput: options.readInput,
    onOutput: options.onOutput,
    terminalInput: options.terminalInput ?? [],
    inputIndex: 0,
  };

  function skipTrivia() {
    while (sourceIndex < sourceLines.length) {
      const entry = sourceLines[sourceIndex];
      if (entry.statement && !entry.statement.startsWith("#")) break;
      sourceIndex += 1;
    }
  }

  function parseBlock(indent = 0) {
    const block = [];
    while (sourceIndex < sourceLines.length) {
      skipTrivia();
      if (sourceIndex >= sourceLines.length) break;
      const entry = sourceLines[sourceIndex];
      if (entry.indent < indent) break;
      if (entry.indent > indent) throw new Error(`Line ${entry.lineNumber}: Unexpected indentation.`);

      const definition = entry.statement.match(/^fbs\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(r|s|e|v)\.([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*:\s*$/);
      if (definition) {
        if (indent !== 0) throw new Error(`Line ${entry.lineNumber}: fbs definitions must be at the top level.`);
        const [, name, parameterType, parameterName] = definition;
        if (functions.has(name)) throw new Error(`Line ${entry.lineNumber}: Function "${name}" already exists.`);
        sourceIndex += 1;
        skipTrivia();
        if (sourceIndex >= sourceLines.length || sourceLines[sourceIndex].indent <= indent) {
          throw new Error(`Line ${entry.lineNumber}: Function "${name}" needs an indented body.`);
        }
        const body = parseBlock(sourceLines[sourceIndex].indent);
        functions.set(name, { parameterType, parameterName, body, lineNumber: entry.lineNumber });
        continue;
      }

      const ifMatch = entry.statement.match(/^if\s+(.+)\s*:\s*$/);
      if (ifMatch) {
        const branches = [];
        let branch = entry;
        let sawElse = false;
        while (true) {
          const branchIf = branch.statement.match(/^if\s+(.+)\s*:\s*$/);
          const branchElif = branch.statement.match(/^elif\s+(.+)\s*:\s*$/);
          const branchElse = branch.statement.match(/^else\s*:\s*$/);
          if (!branchIf && !branchElif && !branchElse) break;
          if (branchElse && sawElse) throw new Error(`Line ${branch.lineNumber}: Only one else block is allowed.`);
          if (sawElse) throw new Error(`Line ${branch.lineNumber}: elif cannot follow else.`);
          sawElse = Boolean(branchElse);
          sourceIndex += 1;
          skipTrivia();
          if (sourceIndex >= sourceLines.length || sourceLines[sourceIndex].indent <= indent) {
            throw new Error(`Line ${branch.lineNumber}: ${branchElse ? "else" : "if/elif"} needs an indented body.`);
          }
          const body = parseBlock(sourceLines[sourceIndex].indent);
          if (!body.length) throw new Error(`Line ${branch.lineNumber}: Block cannot be empty.`);
          branches.push({ condition: branchElse ? null : branchIf?.[1] ?? branchElif?.[1], body, lineNumber: branch.lineNumber });

          skipTrivia();
          const next = sourceLines[sourceIndex];
          if (!next || next.indent !== indent || !/^(?:elif\b|else\s*:)/.test(next.statement)) break;
          branch = next;
        }
        block.push({ kind: "conditional", branches, lineNumber: entry.lineNumber, indent });
        continue;
      }

      if (/^(?:elif\b|else\s*:)/.test(entry.statement)) {
        throw new Error(`Line ${entry.lineNumber}: ${entry.statement.split(/\s/)[0]} without a matching if.`);
      }

      block.push({ kind: "statement", statement: entry.statement, lineNumber: entry.lineNumber, indent });
      sourceIndex += 1;
    }
    return block;
  }

  const statements = parseBlock();

  async function emit(value) {
    const text = Array.isArray(value) ? JSON.stringify(value) : typeof value === "boolean" ? (value ? "True" : "False") : String(value);
    output.push(text);
    await runtime.onOutput?.(text);
  }

  async function readInput(prompt, lineNumber) {
    await runtime.onOutput?.(prompt);
    let value;
    if (runtime.readInput) {
      value = await runtime.readInput(prompt, lineNumber);
    } else if (runtime.inputIndex < runtime.terminalInput.length) {
      value = String(runtime.terminalInput[runtime.inputIndex++]);
      await runtime.onOutput?.(value);
    } else {
      throw new Error(`Line ${lineNumber}: input("${prompt}") is waiting for Terminal Input.`);
    }
    output.push(`${prompt}${prompt ? " " : ""}${value}`);
    return String(value);
  }

  async function executeBlock(block, scope, callDepth = 0) {
    for (const node of block) {
      if (node.kind === "conditional") {
        for (const branch of node.branches) {
          const matches = branch.condition === null
            ? true
            : await evaluateExpression(branch.condition, scope, branch.lineNumber, { ...runtime, readInput });
          if (typeof matches !== "boolean") {
            throw new Error(`Line ${branch.lineNumber}: if/elif condition must be True or False.`);
          }
          if (matches) {
            await executeBlock(branch.body, scope, callDepth);
            break;
          }
        }
        continue;
      }

      const { statement, lineNumber } = node;
      const typedDeclaration = statement.match(/^(r|s|e|v)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (typedDeclaration) {
        const [, typeCode, name, expression] = typedDeclaration;
        if (scope.has(name)) throw new Error(`Line ${lineNumber}: Variable "${name}" already exists.`);
        const value = await evaluateExpression(expression, scope, lineNumber, { ...runtime, readInput });
        const expectedType = typeCode === "r" ? "number" : typeCode === "s" ? "string" : typeCode === "v" ? "list" : null;
        const actualType = Array.isArray(value) ? "list" : typeof value;
        if (expectedType && actualType !== expectedType) {
          throw new Error(`Line ${lineNumber}: ${typeCode} requires a ${expectedType} value.`);
        }
        if (typeCode === "e" && !["number", "string"].includes(actualType)) {
          throw new Error(`Line ${lineNumber}: e requires a number or string value.`);
        }
        scope.set(name, { type: actualType, declaredType: typeCode, value });
        continue;
      }

      const declaration = statement.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (declaration) {
        const [, name, expression] = declaration;
        if (scope.has(name)) throw new Error(`Line ${lineNumber}: Variable "${name}" already exists.`);
        const value = await evaluateExpression(expression, scope, lineNumber, { ...runtime, readInput });
        scope.set(name, { type: typeof value, declaredType: "let", value });
        continue;
      }

      const print = statement.match(/^print\s*(?:\(\s*(.+)\s*\)|(\S.*))$/);
      if (print) {
        await emit(await evaluateExpression(print[1] ?? print[2], scope, lineNumber, { ...runtime, readInput }));
        continue;
      }

      const call = statement.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)$/);
      if (call) {
        const [, name, argumentSource] = call;
        const fn = functions.get(name);
        if (!fn) throw new Error(`Line ${lineNumber}: Unknown function "${name}".`);
        if (callDepth >= 32) throw new Error(`Line ${lineNumber}: Function call depth exceeded.`);
        const value = await evaluateExpression(argumentSource, scope, lineNumber, { ...runtime, readInput });
        const expectedType = fn.parameterType === "r" ? "number" : fn.parameterType === "s" ? "string" : fn.parameterType === "v" ? "list" : null;
        const actualType = Array.isArray(value) ? "list" : typeof value;
        if (expectedType && actualType !== expectedType) {
          throw new Error(`Line ${lineNumber}: Function "${name}" expects a ${expectedType} argument.`);
        }
        if (fn.parameterType === "e" && !["number", "string"].includes(actualType)) {
          throw new Error(`Line ${lineNumber}: Function "${name}" expects a number or string argument.`);
        }
        const localScope = new Map(scope);
        localScope.set(fn.parameterName, {
          type: actualType,
          declaredType: fn.parameterType,
          value,
        });
        await executeBlock(fn.body, localScope, callDepth + 1);
        continue;
      }

      throw new Error(`Line ${lineNumber}: Use a typed declaration, print(...), if block, or function call.`);
    }
  }

  await executeBlock(statements, variables);
  return {
    output,
    variables: Object.fromEntries([...variables].map(([name, variable]) => [name, variable.value])),
    types: Object.fromEntries([...variables].map(([name, variable]) => [name, variable.type])),
    declaredTypes: Object.fromEntries([...variables].map(([name, variable]) => [name, variable.declaredType])),
  };
}