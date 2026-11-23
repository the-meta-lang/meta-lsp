export type Node = Identifier | Literal | BinaryExpression | AssignmentExpression | ExpressionStatement | Program;

export type SimpleNode = {
	type: ParseTreeNodeType,
	children?: SimpleNode[],
	value?: string,
	raw?: string,
	start?: number,
	end?: number,
	[key: string]: any | undefined
}

export type Program = {
	type: ParseTreeNodeType.Program,
	body: Node[]
} & Location;

export enum ParseTreeNodeType {
	ExpressionStatement = "ExpressionStatement",
	VariableDeclaration = "VariableDeclaration",
	AssignmentExpression = "AssignmentExpression",
	BinaryExpression = "BinaryExpression",
	Program = "Program",
	Identifier = "Identifier",
	Literal = "Literal"
}

export type VariableDeclaration = {
	type: ParseTreeNodeType.VariableDeclaration,
	declarations: Node[],
	id: string,
	kind: "var" | "let" | "const"
} & Location;

export type Identifier = {
	type: ParseTreeNodeType.Identifier,
	value: string,
} & Location;

export type Literal = {
	type: ParseTreeNodeType.Literal,
	value: string,
	raw: string,
} & Location;

export type BinaryExpression = {
	type: ParseTreeNodeType.BinaryExpression,
	operator: string,
	left: Node,
	right: Node,
} & Location;

export type AssignmentExpression = {
	type: ParseTreeNodeType.AssignmentExpression,
	operator: string,
	left: Node,
	right: Node,
} & Location;

export type ExpressionStatement = {
	type: ParseTreeNodeType.ExpressionStatement,
	expression: Node,
} & Location;

export type Location = {
	start: number,
	end: number
}