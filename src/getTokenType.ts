import ts from 'typescript/lib/tsserverlibrary';

import { mapPropToToken } from './mapPropToToken';
import { ParsedConfig } from './readConfig';
import { TSContext } from './types';

/**
 * Create a stack of all the nodes at a given position
 */
const getNodeTreeAtPosition = (
  node: ts.Node,
  pos: number,
  depth = 0
): ts.Node[] => {
  const tree: ts.Node[] = [];
  const children = node.getChildren();
  for (const child of children) {
    const start = child.getStart();
    const end = child.getEnd();
    if (start <= pos && pos <= end) {
      tree.push(child);
      tree.push(
        ...children.flatMap((child) =>
          getNodeTreeAtPosition(child, pos, depth + 1)
        )
      );
    }
  }
  return tree;
};

/**
 * Determines whether to show tamagui completions at a given position and if
 * so, which type of tokens to show.
 *
 * Walks up the AST to determine whether the cursor position either is or is
 * a descendant of a node that is one of the following:
 *
 * - A property assignment inside a Tamagui styled() call
 * - A property assignment inside a JSX expression
 * - Or a JSX attribute
 *
 * If a valid property assignment or JSX attribute is found, it's name
 * determines the token type based on the property name.
 */
export const getTokenTypeAtPosition = (
  fileName: string,
  position: number,
  config: ParsedConfig,
  ctx: TSContext
) => {
  const { program, typeChecker, logger } = ctx;
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) return undefined;
  logger(`Found source file: ${sourceFile.fileName}`);

  const nodeTree = getNodeTreeAtPosition(sourceFile, position);

  if (nodeTree.length < 2) return undefined;

  const originNode = nodeTree[nodeTree.length - 1];
  let styledNode: ts.Node | undefined;
  let jsxAttributeNode: ts.Node | undefined;
  let propertyAssignmentNode: ts.Node | undefined;

  let node: ts.Node | undefined;
  while (!jsxAttributeNode && !styledNode && nodeTree.length > 0) {
    node = nodeTree.pop()!;
    if (node.kind === ts.SyntaxKind.PropertyAssignment) {
      // is property assignment
      propertyAssignmentNode = node;
    }
    if (
      node.kind === ts.SyntaxKind.JsxAttribute ||
      node.kind === ts.SyntaxKind.JsxSpreadAttribute
    ) {
      // is inside jsx attribute or jsx spread attribute
      jsxAttributeNode = node;
    }
    const nodeType = typeChecker.getTypeAtLocation(node);
    if (typeChecker.typeToString(nodeType).startsWith('TamaguiComponent<')) {
      // is inside styled() call
      styledNode = node;
    }
  }

  const isTamaguiPropertyAssignment = !!(
    propertyAssignmentNode &&
    (jsxAttributeNode || styledNode)
  );

  const isJsxAttribute = !!jsxAttributeNode;

  logger(`Origin node <${originNode?.getText()}>`);
  logger(`isTamaguiPropertyAssignment <${isTamaguiPropertyAssignment}>`);
  logger(`isJsxAttribute <${isJsxAttribute}>`);

  if (!isTamaguiPropertyAssignment && !isJsxAttribute) return undefined;

  const propMatch = isTamaguiPropertyAssignment
    ? propertyAssignmentNode!.getText().match(/^(\w+):/)
    : jsxAttributeNode!.getText().match(/^(\w+)=/);
  const propName = propMatch?.[1] ?? '';

  logger(`Prop name <${propName}>`);

  if (!propName) return undefined;

  return mapPropToToken(propName, config);
};
