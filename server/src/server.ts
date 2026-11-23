import {
	createConnection,
	TextDocuments,
	Diagnostic,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport,
	CompletionItemKind
} from 'vscode-languageserver/node';

import {
	Position,
	TextDocument
} from 'vscode-languageserver-textdocument';

import { compile } from "./parser";
import { Tree, ParseTreeNodeType } from "./tree";
import { Identifier, VariableDeclaration } from './types';


// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			},
			hoverProvider: true,
			definitionProvider: true,
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.META_LSP || defaultSettings)
		);
	}
	// Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
	// We could optimize things here and re-fetch the setting first can compare it
	// to the existing setting, but this is out of scope for this example.
	connection.languages.diagnostics.refresh();
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'META_LSP'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

connection.onDidChangeConfiguration(async (change) => {
	getDocumentSettings(change.settings);
});

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document !== undefined) {
		return {
			items: [],
			kind: DocumentDiagnosticReportKind.Full
		} satisfies DocumentDiagnosticReport;
	} else {
		// We don't know the document. We can either try to read it from disk
		// or we don't report problems for it.
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: []
		} satisfies DocumentDiagnosticReport;
	}
});

// Create a storage for the compilation results based on the file
const compilationResults: Map<string, {
	error: string | undefined,
	tree: Tree<true>,
	output: string
}> = new Map();

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	const { parsetree, eflag, outbuf } = compile(change.document.getText());
	const tree = Tree.fromObject(parsetree, true);
	compilationResults.set(change.document.uri, {error: eflag ? "Error Occured" : undefined, output: outbuf.toString(), tree});
	connection.languages.diagnostics.refresh();
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// Get the compilation result for the file and retrieve all variable names
		const compilationResult = compilationResults.get(_textDocumentPosition.textDocument.uri);

		if (compilationResult === undefined) {
			return [];
		}

		const completionItems: CompletionItem[] = [];

		// Add all variable names to the completion list
		for (const variable of compilationResult.tree.findNodesWithType(ParseTreeNodeType.AssignmentExpression)) {
			const id = variable.id as string;

			completionItems.push({
				label: id,
				kind: CompletionItemKind.Variable
			});
		}

		return completionItems;
	}
);

function convertPositionToAbsoluteOffset(document: TextDocument, position: { line: number, character: number }) {
	const lines = document.getText().split("\n");
	const offset = lines.slice(0, position.line).reduce((acc, line) => acc + line.length + 1, 0);
	return offset + position.character;
}

connection.onHover((params) => {
	const compilationResult = compilationResults.get(params.textDocument.uri);

	if (compilationResult === undefined) {
		return {
			contents: []
		};
	}

	const tree = compilationResult.tree;
	const offset = convertPositionToAbsoluteOffset(documents.get(params.textDocument.uri)!, params.position);
	const nodes = tree.findNodesAtPosition(offset);

	if (nodes.length === 0) {
		return {
			contents: []
		};
	}

	const node = nodes[nodes.length - 1];
	const type = node.type;

	if (type === ParseTreeNodeType.Identifier) {
		return {
			contents: `Variable ${node.id}`
		};
	}
});

function convertAbsoluteOffsetToPosition(document: TextDocument, offset: number, length: number): {
	startLine: number,
	endLine: number,
	startColumn: number,
	endColumn: number
} {
	const lines = document.getText().split("\n");
	// Depending on the length, the end position might be on a different line
  let currentOffset = 0;
  let startLine = 0;
  let startColumn = 0;
  let endLine = 0;
  let endColumn = 0;

	console.log(offset, length);
	

	const endOffset = offset + length + 1;
	offset++;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let lineLength = lines[lineIndex].length;

		if (lineIndex !== lines.length - 1) {
			// +1 for the newline character
			lineLength++;
		}

    if (offset >= currentOffset && offset < currentOffset + lineLength) {
      startLine = lineIndex; // Convert 0-based index to 1-based line number
      startColumn = offset - currentOffset; // 1-based column number
    }

    if (endOffset >= currentOffset && endOffset < currentOffset + lineLength) {
      endLine = lineIndex; // Convert 0-based index to 1-based line number
      endColumn = endOffset - currentOffset; // 1-based column number
    }

    currentOffset += lineLength;
  }

	return {
		startLine,
		startColumn,
		endLine,
		endColumn
	};
}

connection.onDefinition((params) => {
	const compilationResult = compilationResults.get(params.textDocument.uri);

	if (compilationResult === undefined) {
		return [];
	}

	const tree = compilationResult.tree;
	const offset = convertPositionToAbsoluteOffset(documents.get(params.textDocument.uri)!, params.position);
	const nodes = tree.findNodesAtPosition(offset);

	if (nodes.length === 0) {
		return [];
	}

	// Check if one of the nodes is an identifier
	const identifier = nodes.find((node) => node.type === ParseTreeNodeType.Identifier) as Identifier | undefined;

	if (identifier) {
		const variableDeclarationNodes = Array.from(tree.findNodesWithType(ParseTreeNodeType.VariableDeclaration));
		const definition = variableDeclarationNodes.find((node) => node.id === identifier.value) as VariableDeclaration;

		if (definition === undefined) {
			return [];
		}

		const position = convertAbsoluteOffsetToPosition(documents.get(params.textDocument.uri)!, definition.start as number, (definition.id as string).length);
		console.log(position);
		


		return [{
			uri: params.textDocument.uri,
			range: {
				start: { line: position.startLine, character: position.startColumn },
				end: { line: position.endLine, character: position.endColumn }
			}
		}];
	}

	return [];
});

connection.onCompletionResolve((params) => {
	return params;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
