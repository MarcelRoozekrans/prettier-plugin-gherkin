import {
  Parser as GherkinParser,
  AstBuilder,
  GherkinClassicTokenMatcher,
} from '@cucumber/gherkin';
import {
  IdGenerator,
  GherkinDocument,
  StepKeywordType,
  Location,
} from '@cucumber/messages';
import {
  AstPath,
  Parser,
  Plugin,
  Printer,
  SupportLanguage,
  util,
  doc,
  Doc,
  ParserOptions,
  Options,
} from 'prettier';
import {
  TypedGherkinDocument,
  TypedComment,
  TypedFeature,
  TypedTag,
  TypedFeatureChild,
  TypedScenario,
  GherkinNode,
  TypedGherkinNode,
  TypedStep,
  TypedDocString,
  TypedBackground,
  TypedExamples,
  TypedTableRow,
  TypedTableCell,
  TypedDataTable,
  TypedRule,
  TypedRuleChild,
  isHasChildren,
  isHasChild,
  HasChild,
  HasChildren,
  GherkinNodeWithLocation,
  isWithLocation,
} from './GherkinAST/index.js';

const DEFAULT_ESCAPE_BACKSLASH = false;

// taken from https://github.com/cucumber/gherkin-javascript/blob/e25a1be3b21133c7a92eb7735997c6e774406226/src/GherkinClassicTokenMatcher.ts#L11
const LANGUAGE_PATTERN = /^\s*#\s*language\s*:\s*([a-zA-Z\-_]+)\s*$/;

const { hardline, join, indent } = doc.builders;

const languages: SupportLanguage[] = [
  {
    extensions: ['.feature'],
    name: 'Gherkin',
    parsers: ['gherkin'],
  },
];

function printHardline() {
  // console.log(new Error().stack?.split('\n')[2]);

  return hardline;
}

function printTwoHardlines() {
  // console.log(new Error().stack?.split('\n')[2]);

  return [hardline, hardline];
}

const LINEBREAK_MATCHER = /\r\n|[\r\n\u2028\u2029]/;

/**
 * escaple line breaks in a string
 */
function escapeMultilineString(str: string): string {
  return str.replace(new RegExp(LINEBREAK_MATCHER, 'g'), '\\n');
}

function assertNodeHasLocation(
  node: GherkinNode
): asserts node is GherkinNode & { location: Location } {
  if (!('location' in node)) {
    throw new Error('no location for node ' + node.constructor.name);
  }
}

let textColumnWidth: Array<number> = [];

function generateColumnSizes(text: string) {
  let columnSizes: Array<number> = [];

  let index: number | false = 0;
  let currentLine = 1;
  while ((index = util.skipEverythingButNewLine(text, index)) !== false) {
    columnSizes.push(index + 1);
    index++;
    currentLine++;
  }

  // console.log(columnSizes);

  textColumnWidth = columnSizes;
}

interface GherkinParseOptions extends ParserOptions<GherkinNode> {
  escapeBackslashes?: boolean;
}

const gherkinParser: Parser<GherkinNode> = {
  parse: (text: string, options: GherkinParseOptions): GherkinDocument => {
    const uuidFn = IdGenerator.uuid();
    const builder = new AstBuilder(uuidFn);
    const matcher = new GherkinClassicTokenMatcher(); // or GherkinInMarkdownTokenMatcher()

    const parser = new GherkinParser(builder, matcher);

    const document = parser.parse(text);

    generateColumnSizes(text);

    // console.log({
    //   textColumnWidth,
    //   // document: JSON.stringify(document, null, 2),
    // });

    // console.log(
    //   util.getStringWidth(text),
    //   util.skipEverythingButNewLine(text, 18)
    // );

    return new TypedGherkinDocument(
      {
        ...document,
        // comments: [], // igonre comments for now
      },
      {
        escapeBackslashes:
          options.escapeBackslashes ?? DEFAULT_ESCAPE_BACKSLASH,
      }
    );
  },

  locStart: (node: TypedGherkinNode<GherkinNode>) => {
    // return 0;
    // if (!(node instanceof TypedComment)) {
    //   throw new Error('locStart: not a comment');
    // }

    // console.log('locStart', node);

    assertNodeHasLocation(node);

    // sum all column size until the current line
    let index =
      node.location.line > 1 ? textColumnWidth[node.location.line - 2] : 0;

    index += (node.location.column ?? 1) - 1;

    return index;

    // if (node instanceof TypedComment) {
    //   return 0;
    // }

    // if (node.location) {
    //   return node.location.line * 1000000 + node.location.column;
    // }

    // return 0;
    // return node.location.column ?? 0;
  },
  locEnd: (node: TypedGherkinNode<GherkinNode>) => {
    // return 0; // TMP ignore comments

    // if (!(node instanceof TypedComment)) {
    //   throw new Error('locEnd: not a comment');
    // }

    // console.log('locEnd', node, '\n');

    if (node instanceof TypedComment) {
      return gherkinParser.locStart(node) + node.text.trim().length;
    }

    if (!(node instanceof TypedComment)) {
      console.log({ method: 'locEnd', nodeName: node.constructor.name });
    }

    if (node instanceof TypedFeature) {
      return (
        gherkinParser.locStart(node) +
        node.keyword.length +
        node.name.length +
        2
      );
    }

    // if (!(node instanceof TypedComment)) {
    //   console.log(node, gherkinParser.locStart(node));
    // }

    // if (node.location) {
    //   return node.location.line * 1000000 + node.location.column + 1;
    // }

    // console.log('locEnd', node);

    return gherkinParser.locStart(node) + 1;
    // return (node.location.column ?? 0) + node.text.length;
  },
  astFormat: 'gherkin-ast',
};

function printTags(
  path: AstPath<TypedGherkinNode<GherkinNode & { tags: readonly TypedTag[] }>>,
  node: GherkinNode & { tags: readonly TypedTag[] }
) {
  // console.log(node);

  return [
    // @ts-expect-error TODO path should be recognized as an AstPath<GherkinNode & { tags: readonly TypedTag[] }>>
    join(printHardline(), path.map(gherkinAstPrinter.print, 'tags')),
    node.tags.length > 0 ? printHardline() : '',
  ];
}

function printDescription(
  path: AstPath<TypedGherkinNode<GherkinNode & { description: string }>>,
  node: GherkinNode & { description: string },
  hardlineIfDescription: boolean
) {
  // console.log(node);

  if (!node.description) {
    return hardlineIfDescription ? printHardline() : '';
  }

  return [
    join(
      printHardline(),
      node.description.split('\n').map((s) => s.trim())
    ),
    printHardline(),
    printHardline(),
  ];
}

/**
 * This method will try to find the the location of the
 */
function findNodeForCommentInAST(
  ast: TypedGherkinNode<GherkinNode>,
  comment: TypedComment
): GherkinNodeWithLocation | null {
  const { line, column } = comment.location;

  if (isWithLocation(ast) && ast.location.line > line) {
    return ast;
  }

  if (isHasChild(ast)) {
    const { child } = ast;

    if (child) {
      const node = findNodeForCommentInAST(child, comment);

      if (node) {
        return node;
      }
    }
  }

  if (isHasChildren(ast)) {
    const { children } = ast;

    for (const child of children) {
      const node = findNodeForCommentInAST(child, comment);

      if (node) {
        return node;
      }
    }
  }

  return null;

  return null;
}

function stepNeedsHardline(node: TypedStep, isFirstStep: boolean) {
  return (
    !isFirstStep &&
    node.keywordType &&
    [StepKeywordType.CONTEXT, StepKeywordType.ACTION].includes(node.keywordType)
  );
}

const gherkinAstPrinter: Printer<TypedGherkinNode<GherkinNode>> = {
  printComment: (path, options) => {
    const node = path.getValue();
    // console.log(node);

    if (!(node instanceof TypedComment)) {
      throw new Error('printComment: not a comment');
    }

    const parentNode = path.getParentNode();
    const parentNodeIsFirstStep = path.stack[path.stack.length - 6] === 0;

    // if the comment follows a `Given` step, then the comment should have a leading blank line
    // but no blank line between the comment and the step
    if (
      parentNode instanceof TypedStep &&
      stepNeedsHardline(parentNode, parentNodeIsFirstStep)
    ) {
      return [printHardline(), node.text.trim()];
    }

    return node.text.trim();
  },

  canAttachComment(node): boolean {
    // comments are all in the TypedGherkinDocument.comments array. 
    // Do not handle comments in the subtree of the AST.
    return node instanceof TypedGherkinDocument;
  },

  isBlockComment(node): boolean {
    //   // console.log('isBlockComment', node);
    return false; // block comments are not supported by gherkin for now. See https://cucumber.io/docs/gherkin/reference/
  },

  

  // getCommentChildNodes: (node) => {
  //   console.log('getCommentChildNodes', node)

  //   return []
  // },

  handleComments: {
    ownLine: (
      commentNode: TypedComment,
      text: string,
      options,
      ast,
      isLastComment: boolean
    ) => {
      const node = findNodeForCommentInAST(ast, commentNode);
      if (node) {
        util.addLeadingComment(node, commentNode);

        return true;
      } else {
        // we are on the latest lines of the file, and they all contains comments, so attach comment after the ast
        const isRemainingLinesComments =
          text
            .split('\n')
            .slice(commentNode.location.line)
            .filter((row) => row.match(/^\s#/)).length === 0;

        if (isRemainingLinesComments) {
          util.addTrailingComment(ast, commentNode);

          return true;
        }
      }

      // console.log({ ownLine: commentNode, ast });

      return false;
    },
    endOfLine: (
      commentNode: TypedComment,
      text: string,
      options,
      ast,
      isLastComment: boolean
    ) => {
      const node = findNodeForCommentInAST(ast, commentNode);

      if (node) {
        util.addLeadingComment(node, commentNode);

        return true;
      }
      // console.log({ ownLine: commentNode, ast });

      return false;
    },

    remaining: (
      commentNode: TypedComment,
      text: string,
      options,
      ast,
      isLastComment: boolean
    ) => {
      if (ast instanceof TypedGherkinDocument && !ast.feature) {
        // special case where the document only contains comments : let's attach the comment to the document directly
        util.addLeadingComment(ast, commentNode);

        return true;
      }

      return false;
    },
  },

  print: (path, options, print) => {
    const node = path.getValue();

    // console.log({ node, isDocument: node instanceof TypedGherkinDocument });

    if (node instanceof TypedGherkinDocument) {
      // console.log(node)
      if (node.feature) {
        // @ts-expect-error TODO  path should be recognized as an AstPath<TypedGherkinDocument>
        return [path.call(print, 'feature'), printHardline()];
      } else {
        // return empty string if there is no feature (it can contain only comments)
        return '';
      }
    } else if (node instanceof TypedFeature || node instanceof TypedRule) {
      const hasLanguageInSourceFile = !!options.originalText.match(
        new RegExp(LANGUAGE_PATTERN, 'm')
      );

      return [
        node instanceof TypedFeature && hasLanguageInSourceFile
          ? ['# language: ' + node.language, printHardline()]
          : '',
        printTags(path, node),
        `${node.keyword}: ${node.name}`,

        indent([
          printHardline(),
          printDescription(path, node, true),

          // @ts-expect-error TODO path should be recognized as an AstPath<TypedFeature>
          join(printTwoHardlines(), path.map(print, 'children')),
        ]),
      ];
    } else if (
      node instanceof TypedFeatureChild ||
      node instanceof TypedRuleChild
    ) {
      if (node.scenario) {
        // @ts-expect-error TODO  path should be recognized as an AstPath<TypedFeatureChild>
        return path.call(print, 'scenario');
      } else if (node.background) {
        // @ts-expect-error TODO  path should be recognized as an AstPath<TypedFeatureChild>
        return path.call(print, 'background');
      } else if (node instanceof TypedFeatureChild && node.rule) {
        // @ts-expect-error TODO  path should be recognized as an AstPath<TypedFeatureChild>
        return path.call(print, 'rule');
      } else {
        console.log(node);
        throw new Error(
          `unhandled case where ${
            node instanceof TypedFeatureChild
              ? 'TypedFeatureChild'
              : 'TypedRuleChild'
          } has no scenario`
        );
      }
    } else if (node instanceof TypedTag) {
      return node.name;
    } else if (node instanceof TypedBackground) {
      // console.log(node.steps);
      return [
        `${node.keyword}: ${node.name}`,
        node.description || node.steps.length > 0
          ? indent([
              printHardline(),
              printDescription(path, node, false),
              // @ts-expect-error TODO  path should be recognized as an AstPath<TypedBackground>
              join(printHardline(), path.map(print, 'steps')),
            ])
          : '',
      ];
    } else if (node instanceof TypedScenario) {
      // console.log(node);
      return [
        printTags(path, node),
        `${node.keyword}: ${node.name}`,
        indent([
          printHardline(),
          printDescription(path, node, false),

          // @ts-expect-error TODO path should be recognized as an AstPath<TypedScenario>
          join(printHardline(), path.map(print, 'steps')),

          node.steps.length > 0 && node.examples.length > 0
            ? printTwoHardlines()
            : '',
          // @ts-expect-error TODO path should be recognized as an AstPath<TypedScenario>
          join(printTwoHardlines(), path.map(print, 'examples')),
        ]),
      ];
    } else if (node instanceof TypedStep) {
      // console.log(node);
      return [
        // if the step has comment, the hardline will be handled by the comment printer
        stepNeedsHardline(node, path.stack[path.stack.length - 2] === 0) &&
        // @ts-expect-error comments are injected by prettier directly
        !node.comments
          ? printHardline()
          : '',
        `${node.keyword}${node.text.trim()}`,
        node.docString
          ? // @ts-expect-error TODO path should be recognized as an AstPath<TypedStep>
            indent([printHardline(), path.call(print, 'docString')])
          : '',
        node.dataTable // @ts-expect-error TODO path should be recognized as an AstPath<TypedStep>
          ? indent([printHardline(), path.call(print, 'dataTable')])
          : '',
      ];
    } else if (node instanceof TypedDocString) {
      // console.log({ node });

      // if the content contains the delimiter, the parser will unescape it, so we need to escape it again
      const escapeDelimiter = (content: string) => {
        return content.replace(
          new RegExp(`(${node.delimiter})`, 'g'),
          (match) => {
            return match
              .split('')
              .map((c) => `\\${c}`)
              .join('');
          }
        );
      };

      return join(printHardline(), [
        [node.delimiter, node.mediaType || ''],
        // split the string on newlines to preserve the indentation
        ...escapeDelimiter(node.content).split('\n'),
        node.delimiter,
      ]);
    } else if (node instanceof TypedExamples) {
      // console.log({ node, columnSizes: node.columnSizes });

      return [
        printTags(path, node),
        `${node.keyword}: ${node.name}`,

        indent([
          printHardline(),
          printDescription(path, node, false),
          join(
            printHardline(),
            [
              // @ts-expect-error TODO path should be recognized as an AstPath<TypedExamples>
              node.tableHeader && path.call(print, 'tableHeader'),
              // @ts-expect-error TODO path should be recognized as an AstPath<TypedExamples>
              ...path.map(print, 'tableBody'),
            ].filter((d): d is Doc => !!d)
          ),
        ]),
      ];
    } else if (node instanceof TypedDataTable) {
      // console.log({ node, columnSizes: node.columnSizes });

      return join(printHardline(), [
        // @ts-expect-error TODO path should be recognized as an AstPath<TypedDataTable>
        ...path.map(print, 'rows'),
      ]);
    } else if (node instanceof TypedTableRow) {
      // console.log(node);
      return [
        '| ',
        // @ts-expect-error TODO path should be recognized as an AstPath<TypedTableRow>
        join(' | ', path.map(print, 'cells')),
        ' |',
      ];
    } else if (node instanceof TypedTableCell) {
      // console.log(node);
      return escapeMultilineString(node.value.padEnd(node.displaySize));
    } else {
      console.error('Unhandled node type', node);
      return '';
    }
  },

  embed(path: AstPath, options: Options) {
    const node = path.getValue();
    if (node instanceof TypedDocString) {
      const { content, mediaType } = node;

      if (mediaType === 'xml') {
        return async (textToDoc): Promise<Doc> => {
          return [
            node.delimiter,
            mediaType,
            printHardline(),
            await textToDoc(content, { ...options, parser: 'html' }),
            printHardline(),
            node.delimiter,
          ];
        };
      }

      try {
        JSON.parse(content);

        return async (textToDoc): Promise<Doc> => {
          return [
            node.delimiter,
            mediaType ?? '',
            printHardline(),
            await textToDoc(content, { ...options, parser: 'json' }),
            printHardline(),
            node.delimiter,
          ];
        };
      } catch (e) {
        // igonre non-JSON content
      }
    }

    return null;
  },
};

const plugin: Plugin<TypedGherkinNode<GherkinNode>> = {
  languages,
  parsers: {
    gherkin: gherkinParser,
  },
  printers: {
    'gherkin-ast': gherkinAstPrinter,
  },
  defaultOptions: {
    printWidth: 120,
    tabWidth: 4,
  },
  options: {
    escapeBackslashes: {
      type: 'boolean',
      default: DEFAULT_ESCAPE_BACKSLASH,
      description: 'Escape backslashes in strings',
      oppositeDescription: 'Do not escape backslashes in strings',
      category: 'Format',
    },
  },
};

export default plugin;
