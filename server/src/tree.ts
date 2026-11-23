import { ParseTreeNodeType, type Program, type Node, type SimpleNode } from "./types";
import { EventEmitter } from "events";

export { ParseTreeNodeType };

export class Tree<SimpleNodeSyntax extends boolean> {
	public program: Program;
	private flattened: (SimpleNodeSyntax extends true ? SimpleNode : Node)[] = [];

	constructor(program: Program, public useSimpleNodeSyntax: SimpleNodeSyntax) {
		this.program = program;
		this.flatten(program);
	}

	toString() {
		return JSON.stringify(this.program, null, 2);
	}

	toJSON() {
		return this.program;
	}

	static fromObject<SimpleNodeSyntax extends boolean>(json: any, useSimpleNodeSyntax: SimpleNodeSyntax) {
		return new Tree<SimpleNodeSyntax>(json, useSimpleNodeSyntax);
	}

	public flatten(node: (SimpleNodeSyntax extends true ? SimpleNode : Node)) {
		this.flattened.push(node);

		if (this.useSimpleNodeSyntax === true) {
			if ("children" in node && Array.isArray(node.children)) {
				node.children.forEach((child) => this.flatten(child as (SimpleNodeSyntax extends true ? SimpleNode : Node)));
			}
			return;
		}

		if (node.type === ParseTreeNodeType.Program) {
			node.body.forEach((child: Node) => this.flatten(child));
		} else if (node.type === ParseTreeNodeType.ExpressionStatement) {
			this.flatten(node.expression);
		} else if (
			node.type === ParseTreeNodeType.AssignmentExpression ||
			node.type === ParseTreeNodeType.BinaryExpression
		) {
			this.flatten(node.left);
			this.flatten(node.right);
		}
	}

	public findNodesAtPosition(position: number) {
		const found: (SimpleNodeSyntax extends true ? SimpleNode : Node)[] = [];
		for (const node of this.flattened) {
			if (typeof node.start !== "undefined" && node.start <= position && typeof node.end !== "undefined" && node.end >= position) {
				found.push(node);
			}
		}
		return found;
	}

	public *findNodesWithType(type: ParseTreeNodeType) {
		for (const node of this.flattened) {
			if (node.type === type) {
				yield node;
			}
		}
	}

	public *findNodesWithTypes(types: ParseTreeNodeType[]) {
		for (const node of this.flattened) {
			if (types.includes(node.type)) {
				yield node;
			}
		}
	}
}


export class TreeVisitor<SimpleNodeSyntax extends boolean> {
	private emitter: EventEmitter;

	constructor(public useSimpleNodeSyntax: SimpleNodeSyntax) {
		this.emitter = new EventEmitter();
	}

	on(type: ParseTreeNodeType, listener: (node: Node) => void) {
		this.emitter.on(type, listener);
	}

	visit(node: Node): void {
		this.emitter.emit(node.type, node);

		if (this.useSimpleNodeSyntax === true) {
			if ("children" in node && Array.isArray(node.children)) {
				node.children.forEach((child) => this.visit(child));
			}
			return;
		}

		if (node.type === ParseTreeNodeType.Program) {
			node.body.forEach((child) => this.visit(child));
		} else if (node.type === ParseTreeNodeType.ExpressionStatement) {
			this.visit(node.expression);
		} else if (
			node.type === ParseTreeNodeType.AssignmentExpression ||
			node.type === ParseTreeNodeType.BinaryExpression
		) {
			this.visit(node.left);
			this.visit(node.right);
		}
	}
}