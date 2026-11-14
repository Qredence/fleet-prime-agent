import ts from "typescript";

export const relativeUiImportPattern = /(?:\bfrom\s+|\bimport\s+(?=["'])|\bimport\s*\(\s*)["'](?:\.\.\/)+ui(?:\/|["'])/;

export const nativeControlPattern = /<(?:button|input|select|textarea|dialog|m\.button)\b/;

const STATIC_CSS_PROPERTIES = new Set([
	"gridArea",
	"gridTemplateAreas",
	"backgroundColor",
	"background",
	"color",
	"fontSize",
	"fontWeight",
	"lineHeight",
	"letterSpacing",
	"transform",
	"transformOrigin",
	"contentVisibility",
	"pointerEvents",
	"position",
	"display",
	"gap",
	"rowGap",
	"columnGap",
	"overflow",
	"overflowX",
	"overflowY",
	"opacity",
	"zIndex",
	"cursor",
	"width",
	"height",
	"minWidth",
	"maxWidth",
	"minHeight",
	"maxHeight",
	"left",
	"right",
	"top",
	"bottom",
	"inset",
]);

const STATIC_CSS_PREFIX_PATTERN = /^(?:margin|padding|border)/;

function unwrapExpression(node: ts.Expression): ts.Expression {
	let current = node;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isNonNullExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

function isStaticLiteral(node: ts.Expression): boolean {
	const expr = unwrapExpression(node);
	if (
		ts.isStringLiteral(expr) ||
		ts.isNoSubstitutionTemplateLiteral(expr) ||
		ts.isNumericLiteral(expr) ||
		expr.kind === ts.SyntaxKind.TrueKeyword ||
		expr.kind === ts.SyntaxKind.FalseKeyword
	) {
		return true;
	}
	return (
		ts.isPrefixUnaryExpression(expr) &&
		(expr.operator === ts.SyntaxKind.MinusToken || expr.operator === ts.SyntaxKind.PlusToken) &&
		ts.isNumericLiteral(expr.operand)
	);
}

function collectStyleObjectLiterals(expr: ts.Expression, out: ts.ObjectLiteralExpression[]) {
	const unwrapped = unwrapExpression(expr);
	if (ts.isObjectLiteralExpression(unwrapped)) {
		out.push(unwrapped);
		return;
	}
	// Resolve local const aliases without following imports, calls or mutable state.
	if (ts.isIdentifier(unwrapped)) {
		let scope: ts.Node | undefined = unwrapped.parent;
		while (scope) {
			if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
				for (const statement of scope.statements) {
					if (!ts.isVariableStatement(statement)) continue;
					for (const declaration of statement.declarationList.declarations) {
						if (!ts.isIdentifier(declaration.name) || declaration.name.text !== unwrapped.text) continue;
						if (
							statement.declarationList.flags & ts.NodeFlags.Const &&
							declaration.initializer &&
							declaration.getStart() < unwrapped.getStart()
						) {
							collectStyleObjectLiterals(declaration.initializer, out);
						}
						return;
					}
				}
			}
			if (
				ts.isFunctionLike(scope) &&
				scope.parameters.some(
					(parameter) => !ts.isIdentifier(parameter.name) || parameter.name.text === unwrapped.text,
				)
			)
				return;
			scope = scope.parent;
		}
	}
	if (ts.isConditionalExpression(unwrapped)) {
		collectStyleObjectLiterals(unwrapped.whenTrue, out);
		collectStyleObjectLiterals(unwrapped.whenFalse, out);
	}
}

export interface StaticInlineStyleViolation {
	line: number;
	properties: string[];
}

/**
 * Flags static/themeable `style={{ ... }}` inline object literals while
 * permitting runtime-computed expressions and dynamic CSS custom properties.
 */
export function findStaticInlineStyleViolations(sourceFile: ts.SourceFile): StaticInlineStyleViolation[] {
	const violations: StaticInlineStyleViolation[] = [];

	function visit(node: ts.Node) {
		if (
			ts.isJsxAttribute(node) &&
			node.name.getText(sourceFile) === "style" &&
			node.initializer &&
			ts.isJsxExpression(node.initializer) &&
			node.initializer.expression
		) {
			const objects: ts.ObjectLiteralExpression[] = [];
			collectStyleObjectLiterals(node.initializer.expression, objects);

			for (const obj of objects) {
				if (obj.properties.length === 0) continue;
				const bannedProps: string[] = [];
				let hasDynamic = false;

				for (const prop of obj.properties) {
					if (ts.isSpreadAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
						hasDynamic = true;
						continue;
					}
					if (!ts.isPropertyAssignment(prop)) continue;
					if (ts.isComputedPropertyName(prop.name)) {
						hasDynamic = true;
						continue;
					}
					const propName =
						ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)
							? prop.name.text
							: prop.name.getText(sourceFile);
					if (!isStaticLiteral(prop.initializer)) {
						hasDynamic = true;
						continue;
					}

					if (
						propName.startsWith("--") ||
						STATIC_CSS_PROPERTIES.has(propName) ||
						STATIC_CSS_PREFIX_PATTERN.test(propName)
					) {
						bannedProps.push(propName);
					}
				}

				if (bannedProps.length > 0 || !hasDynamic) {
					const { line } = sourceFile.getLineAndCharacterOfPosition(obj.getStart(sourceFile));
					violations.push({
						line: line + 1,
						properties:
							bannedProps.length > 0
								? bannedProps
								: obj.properties.map((p) =>
										ts.isPropertyAssignment(p) ? p.name.getText(sourceFile) : "style",
									),
					});
				}
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return violations;
}
