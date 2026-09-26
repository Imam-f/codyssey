export function declarationTarget(file, symbol) {
  if (!file || !symbol || !["class", "function"].includes(symbol.kind)) return null;
  const scopes = new Map(file.scopes.map((scope) => [scope.id, scope]));
  const chain = [{ kind: symbol.kind, name: symbol.name }];
  let scope = scopes.get(symbol.scopeId);
  while (scope && scope.kind !== "module") {
    if (["class", "function"].includes(scope.kind))
      chain.unshift({ kind: scope.kind, name: scope.name });
    scope = scopes.get(scope.parent);
  }
  return { path: file.path, line: symbol.line, chain };
}

export function declarationAtLine(file, line) {
  return file?.symbols
    .filter((symbol) => ["class", "function"].includes(symbol.kind) &&
      symbol.line <= line && symbol.endLine >= line)
    .sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0] || null;
}
