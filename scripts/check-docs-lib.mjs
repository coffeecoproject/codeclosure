import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

const ignoredMarkdownSourceDirectoryNames = new Set(['.git', 'coverage', 'dist', 'node_modules']);
const maxSymbolicLinkHops = 40;
const nonPortableRepositorySegmentCharacters = new Set(['<', '>', ':', '"', '\\', '|', '?', '*']);
const unicodeNonVisiblePattern = /[\p{Cc}\p{Default_Ignorable_Code_Point}]/gu;
const readmeStatusProseNodeTypes = new Set([
  'break',
  'delete',
  'emphasis',
  'inlineCode',
  'link',
  'linkReference',
  'paragraph',
  'strong',
  'text',
]);
const requiredReadmeStatusTargets = [
  'docs/plans/m1-deterministic-skeleton.md',
  'docs/milestones.md',
];

function collectMarkdownSources(repositoryRoot, directory = repositoryRoot) {
  const files = [];
  const issues = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredMarkdownSourceDirectoryNames.has(entry.name)) {
        const nestedSources = collectMarkdownSources(repositoryRoot, entryPath);
        files.push(...nestedSources.files);
        issues.push(...nestedSources.issues);
      }
      continue;
    }

    if (entry.isSymbolicLink() && entry.name.toLowerCase().endsWith('.md')) {
      issues.push({
        kind: 'symbolic-link-source',
        repositoryPath: repositoryPath(repositoryRoot, entryPath),
      });
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const sourceRepositoryPath = repositoryPath(repositoryRoot, entryPath);
      if (
        sourceRepositoryPath.split('/').some((segment) => isNonPortableRepositorySegment(segment))
      ) {
        issues.push({ kind: 'non-portable-source-path', repositoryPath: sourceRepositoryPath });
      }
      files.push(entryPath);
    }
  }

  return { files, issues };
}

function walk(node, visit) {
  visit(node);

  if (!Array.isArray(node.children)) {
    return;
  }

  for (const child of node.children) {
    walk(child, visit);
  }
}

function textContent(node) {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
    return node.value;
  }

  if (node.type === 'image' || node.type === 'imageReference') {
    return node.alt ?? '';
  }

  if (!Array.isArray(node.children)) {
    return '';
  }

  return node.children.map((child) => textContent(child)).join('');
}

function visiblePhrasingText(node) {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'html') {
    return node.value;
  }

  if (node.type === 'image' || node.type === 'imageReference') {
    return node.alt ?? '';
  }

  if (node.type === 'break') {
    return '\n';
  }

  if (!Array.isArray(node.children)) {
    return '';
  }

  return node.children.map((child) => visiblePhrasingText(child)).join('');
}

function readerVisiblePhrasingText(node) {
  return visiblePhrasingText(node).replace(unicodeNonVisiblePattern, '');
}

function hasNumberedSliceProse(tree) {
  let found = false;

  walk(tree, (node) => {
    if (
      !found &&
      (node.type === 'heading' || node.type === 'paragraph' || node.type === 'tableCell') &&
      /\bSlice\s+\d+\b/iu.test(readerVisiblePhrasingText(node))
    ) {
      found = true;
    }
  });

  return found;
}

function createDocument(filePath) {
  const tree = fromMarkdown(readFileSync(filePath, 'utf8'), {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const definitions = new Map();
  const headingAnchors = new Set();
  const slugger = new GithubSlugger();

  walk(tree, (node) => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }

    if (node.type === 'heading') {
      headingAnchors.add(slugger.slug(textContent(node)));
    }
  });

  return { definitions, filePath, headingAnchors, tree };
}

function collectLinks(document, nodes = [document.tree]) {
  const links = [];

  for (const rootNode of nodes) {
    walk(rootNode, (node) => {
      if (node.type === 'link' || node.type === 'image') {
        links.push({
          kind: node.type === 'link' ? 'link' : 'image',
          node,
          url: node.url,
        });
        return;
      }

      if (node.type !== 'linkReference' && node.type !== 'imageReference') {
        return;
      }

      const definition = document.definitions.get(node.identifier);
      if (definition !== undefined) {
        links.push({
          kind: node.type === 'linkReference' ? 'link' : 'image',
          node,
          url: definition.url,
        });
      }
    });
  }

  return links;
}

function repositoryPath(repositoryRoot, filePath) {
  return relative(repositoryRoot, filePath).split(sep).join('/');
}

function isOutsideRoot(root, target) {
  const targetFromRoot = relative(root, target);
  return (
    targetFromRoot === '..' || targetFromRoot.startsWith(`..${sep}`) || isAbsolute(targetFromRoot)
  );
}

function sourceLocation(repositoryRoot, document, node) {
  const line = node.position?.start.line;
  const suffix = line === undefined ? '' : `:${line}`;
  return `${repositoryPath(repositoryRoot, document.filePath)}${suffix}`;
}

function isNonPortableRepositorySegment(segment) {
  const windowsStem = segment.split('.')[0];
  const hasInvalidCharacter = [...segment].some(
    (character) =>
      character.codePointAt(0) <= 0x1f || nonPortableRepositorySegmentCharacters.has(character),
  );
  return (
    hasInvalidCharacter ||
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    /^(?:aux|con|conin\$|conout\$|nul|prn|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(windowsStem)
  );
}

function normalizeRepositoryPath(baseDirectory, inputSegments) {
  const segments =
    baseDirectory.length === 0 || baseDirectory === '.' ? [] : baseDirectory.split('/');

  if (segments.some((segment) => isNonPortableRepositorySegment(segment))) {
    return { kind: 'non-portable-path-segment' };
  }

  for (const segment of inputSegments) {
    if (segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (segments.length === 0) {
        return { kind: 'outside-repository' };
      }
      segments.pop();
      continue;
    }

    if (isNonPortableRepositorySegment(segment)) {
      return { kind: 'non-portable-path-segment' };
    }

    segments.push(segment);
  }

  return { kind: 'valid', repositoryTarget: segments.join('/') };
}

function hostPathForRepositoryPath(repositoryRoot, target) {
  return target.length === 0 ? repositoryRoot : resolve(repositoryRoot, ...target.split('/'));
}

function decodeRepositoryUrlPath(encodedPath) {
  const rootRelative = encodedPath.startsWith('/');
  const pathWithoutRoot = rootRelative ? encodedPath.slice(1) : encodedPath;
  const encodedSegments = pathWithoutRoot.length === 0 ? [] : pathWithoutRoot.split('/');
  const terminalSegment = encodedSegments.at(-1);
  const requiresDirectory =
    encodedPath === '/' ||
    terminalSegment === '' ||
    terminalSegment === '.' ||
    terminalSegment === '..';

  if (requiresDirectory && encodedSegments.at(-1) === '') {
    encodedSegments.pop();
  }

  if (encodedSegments.some((segment) => segment.length === 0)) {
    return { kind: 'non-portable-path-separator' };
  }

  const decodedSegments = [];
  for (const encodedSegment of encodedSegments) {
    let decodedSegment;
    try {
      decodedSegment = decodeURIComponent(encodedSegment);
    } catch {
      return { kind: 'invalid-encoding' };
    }

    if (decodedSegment.includes('/') || decodedSegment.includes('\\')) {
      return { kind: 'non-portable-path-separator' };
    }
    if ((decodedSegment === '.' || decodedSegment === '..') && decodedSegment !== encodedSegment) {
      return { kind: 'non-canonical-path-segment' };
    }

    decodedSegments.push(decodedSegment);
  }

  return { decodedSegments, kind: 'valid', requiresDirectory, rootRelative };
}

function resolveDestination(repositoryRoot, sourcePath, url) {
  if (/^[A-Za-z]:/u.test(url)) {
    return { kind: 'ambiguous-windows-drive-path' };
  }

  if (url.startsWith('//') || /^[A-Za-z][A-Za-z\d+.-]+:/u.test(url)) {
    return { kind: 'non-local' };
  }

  const fragmentIndex = url.indexOf('#');
  const encodedFragment = fragmentIndex === -1 ? undefined : url.slice(fragmentIndex + 1);
  const pathAndQuery = fragmentIndex === -1 ? url : url.slice(0, fragmentIndex);
  const queryIndex = pathAndQuery.indexOf('?');
  const encodedPath = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);

  let decodedFragment;
  try {
    decodedFragment =
      encodedFragment === undefined ? undefined : decodeURIComponent(encodedFragment);
  } catch {
    return { kind: 'invalid-encoding' };
  }

  const decodedPath = decodeRepositoryUrlPath(encodedPath);
  if (decodedPath.kind !== 'valid') {
    return decodedPath;
  }

  const sourceRepositoryPath = repositoryPath(repositoryRoot, sourcePath);
  const normalizedTarget =
    encodedPath.length === 0
      ? normalizeRepositoryPath('', sourceRepositoryPath.split('/'))
      : normalizeRepositoryPath(
          decodedPath.rootRelative ? '' : posix.dirname(sourceRepositoryPath),
          decodedPath.decodedSegments,
        );
  if (normalizedTarget.kind !== 'valid') {
    return normalizedTarget;
  }

  const resolvedTarget = hostPathForRepositoryPath(
    repositoryRoot,
    normalizedTarget.repositoryTarget,
  );
  if (isOutsideRoot(repositoryRoot, resolvedTarget)) {
    return { kind: 'outside-repository' };
  }

  return {
    fragment: decodedFragment,
    kind: 'local',
    requiresDirectory: decodedPath.requiresDirectory,
    repositoryTarget: normalizedTarget.repositoryTarget,
    resolvedTarget,
  };
}

function inspectRepositoryPath(
  repositoryRoot,
  realRepositoryRoot,
  resolvedTarget,
  visitedSymbolicLinks = new Set(),
) {
  const relativeTarget = relative(repositoryRoot, resolvedTarget);
  const segments = relativeTarget.length === 0 ? [] : relativeTarget.split(sep);
  let currentPath = repositoryRoot;

  for (const segment of segments) {
    let entries;
    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return { kind: 'missing' };
    }

    if (!entries.some((entry) => entry.name === segment)) {
      const requestedEntry = resolve(currentPath, segment);
      const caseInsensitiveMatch = entries.some(
        (entry) => entry.name.toLowerCase() === segment.toLowerCase(),
      );
      if (caseInsensitiveMatch || existsSync(requestedEntry)) {
        return { kind: 'case-mismatch' };
      }
      return { kind: 'missing' };
    }

    currentPath = resolve(currentPath, segment);

    let pathStat;
    try {
      pathStat = lstatSync(currentPath);
    } catch {
      return { kind: 'missing' };
    }

    if (pathStat.isSymbolicLink()) {
      if (visitedSymbolicLinks.has(currentPath)) {
        return { kind: 'symbolic-link-cycle' };
      }
      if (visitedSymbolicLinks.size >= maxSymbolicLinkHops) {
        return { kind: 'symbolic-link-depth-exceeded' };
      }

      let storedTarget;
      try {
        storedTarget = readlinkSync(currentPath);
      } catch {
        return { kind: 'missing' };
      }

      if (isAbsolute(storedTarget)) {
        let absoluteRealTarget;
        try {
          absoluteRealTarget = realpathSync.native(currentPath);
        } catch {
          return { kind: 'missing' };
        }

        if (isOutsideRoot(realRepositoryRoot, absoluteRealTarget)) {
          return { kind: 'real-target-outside-repository' };
        }
        return { kind: 'non-portable-symbolic-link-target' };
      }

      if (storedTarget.includes('\\')) {
        return { kind: 'non-portable-symbolic-link-target' };
      }

      const storedTargetRequiresDirectory = storedTarget.endsWith('/');
      const storedTargetSegments = storedTarget.split('/');
      if (storedTargetRequiresDirectory && storedTargetSegments.at(-1) === '') {
        storedTargetSegments.pop();
      }
      if (storedTargetSegments.some((segment) => segment.length === 0)) {
        return { kind: 'non-portable-symbolic-link-target' };
      }

      const symbolicLinkParent = repositoryPath(repositoryRoot, dirname(currentPath));
      const normalizedSymbolicLinkTarget = normalizeRepositoryPath(
        symbolicLinkParent,
        storedTargetSegments,
      );
      if (normalizedSymbolicLinkTarget.kind === 'outside-repository') {
        return { kind: 'real-target-outside-repository' };
      }
      if (normalizedSymbolicLinkTarget.kind !== 'valid') {
        return { kind: 'non-portable-symbolic-link-target' };
      }

      const nextVisitedSymbolicLinks = new Set(visitedSymbolicLinks);
      nextVisitedSymbolicLinks.add(currentPath);
      const targetIdentity = inspectRepositoryPath(
        repositoryRoot,
        realRepositoryRoot,
        hostPathForRepositoryPath(repositoryRoot, normalizedSymbolicLinkTarget.repositoryTarget),
        nextVisitedSymbolicLinks,
      );
      if (targetIdentity.kind === 'case-mismatch') {
        return { kind: 'symbolic-link-target-case-mismatch' };
      }
      if (targetIdentity.kind !== 'valid') {
        return targetIdentity;
      }
      if (storedTargetRequiresDirectory && !targetIdentity.isDirectory) {
        return { kind: 'non-portable-symbolic-link-target' };
      }
    }
  }

  let realTarget;
  let realTargetStat;
  try {
    realTarget = realpathSync.native(resolvedTarget);
    realTargetStat = lstatSync(realTarget);
  } catch {
    return { kind: 'missing' };
  }

  if (isOutsideRoot(realRepositoryRoot, realTarget)) {
    return { kind: 'real-target-outside-repository' };
  }

  return { isDirectory: realTargetStat.isDirectory(), kind: 'valid', realTarget };
}

function findStatusSections(document) {
  const children = document.tree.children;
  const sections = [];

  for (const [headingIndex, heading] of children.entries()) {
    if (
      heading.type !== 'heading' ||
      heading.depth !== 2 ||
      textContent(heading).trim() !== 'Status'
    ) {
      continue;
    }

    const nodes = [];
    for (const node of children.slice(headingIndex + 1)) {
      if (node.type === 'heading' && node.depth <= 2) {
        break;
      }
      nodes.push(node);
    }
    sections.push(nodes);
  }

  return sections;
}

function hasUnsupportedStatusStructure(statusSection) {
  let unsupported = statusSection.some((node) => node.type !== 'paragraph');

  for (const paragraph of statusSection) {
    walk(paragraph, (node) => {
      if (!readmeStatusProseNodeTypes.has(node.type)) {
        unsupported = true;
      }
    });
  }

  return unsupported;
}

export function checkDocumentation({ repositoryRoot: inputRepositoryRoot }) {
  const repositoryRoot = resolve(inputRepositoryRoot);
  const markdownSources = collectMarkdownSources(repositoryRoot);
  const markdownFiles = markdownSources.files;
  const realRepositoryRoot = realpathSync.native(repositoryRoot);
  const errors = markdownSources.issues.map((issue) => {
    if (issue.kind === 'symbolic-link-source') {
      return `${issue.repositoryPath} is a symbolic link; Markdown sources must be regular files.`;
    }
    return `${issue.repositoryPath} is a Markdown source with a non-portable repository path segment.`;
  });
  const documents = new Map();
  const reportedLoadFailures = new Set();

  function loadDocument(filePath) {
    if (documents.has(filePath)) {
      return documents.get(filePath);
    }

    try {
      const document = createDocument(filePath);
      documents.set(filePath, document);
      return document;
    } catch (error) {
      documents.set(filePath, undefined);
      if (!reportedLoadFailures.has(filePath)) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${repositoryPath(repositoryRoot, filePath)} could not be parsed: ${message}`);
        reportedLoadFailures.add(filePath);
      }
      return undefined;
    }
  }

  for (const markdownFile of markdownFiles) {
    const document = loadDocument(markdownFile);
    if (document === undefined) {
      continue;
    }

    walk(document.tree, (node) => {
      if (node.type === 'html') {
        errors.push(
          `${sourceLocation(repositoryRoot, document, node)} uses raw HTML; use GitHub Flavored Markdown syntax instead.`,
        );
      }
    });

    for (const link of collectLinks(document)) {
      const destination = resolveDestination(repositoryRoot, document.filePath, link.url);
      const location = sourceLocation(repositoryRoot, document, link.node);

      if (destination.kind === 'non-local') {
        continue;
      }
      if (destination.kind === 'ambiguous-windows-drive-path') {
        errors.push(`${location} uses an ambiguous Windows drive path: ${link.url}`);
        continue;
      }
      if (destination.kind === 'invalid-encoding') {
        errors.push(`${location} has an invalid percent-encoded local link: ${link.url}`);
        continue;
      }
      if (destination.kind === 'non-portable-path-separator') {
        errors.push(
          `${location} uses a non-portable or encoded path separator in a local link: ${link.url}`,
        );
        continue;
      }
      if (destination.kind === 'non-canonical-path-segment') {
        errors.push(`${location} uses an encoded dot segment in a local link: ${link.url}`);
        continue;
      }
      if (destination.kind === 'non-portable-path-segment') {
        errors.push(`${location} uses a non-portable repository path segment: ${link.url}`);
        continue;
      }
      if (destination.kind === 'outside-repository') {
        errors.push(`${location} links outside the repository: ${link.url}`);
        continue;
      }

      const pathIdentity = inspectRepositoryPath(
        repositoryRoot,
        realRepositoryRoot,
        destination.resolvedTarget,
      );
      if (pathIdentity.kind === 'case-mismatch') {
        errors.push(`${location} uses incorrect path casing: ${link.url}`);
        continue;
      }
      if (pathIdentity.kind === 'symbolic-link-target-case-mismatch') {
        errors.push(`${location} uses incorrect symbolic-link target casing: ${link.url}`);
        continue;
      }
      if (pathIdentity.kind === 'missing') {
        errors.push(`${location} links to missing path: ${link.url}`);
        continue;
      }
      if (pathIdentity.kind === 'real-target-outside-repository') {
        errors.push(
          `${location} links through a path that resolves outside the repository: ${link.url}`,
        );
        continue;
      }
      if (pathIdentity.kind === 'non-portable-symbolic-link-target') {
        errors.push(
          `${location} links through a symbolic link with a non-portable target: ${link.url}`,
        );
        continue;
      }
      if (pathIdentity.kind === 'symbolic-link-cycle') {
        errors.push(`${location} links through a symbolic-link cycle: ${link.url}`);
        continue;
      }
      if (pathIdentity.kind === 'symbolic-link-depth-exceeded') {
        errors.push(`${location} links through too many symbolic links: ${link.url}`);
        continue;
      }
      if (destination.requiresDirectory && !pathIdentity.isDirectory) {
        errors.push(`${location} uses directory URL syntax for a non-directory path: ${link.url}`);
        continue;
      }

      if (
        destination.fragment !== undefined &&
        destination.fragment.length > 0 &&
        extname(pathIdentity.realTarget).toLowerCase() === '.md'
      ) {
        const targetDocument = loadDocument(pathIdentity.realTarget);
        if (
          targetDocument !== undefined &&
          !targetDocument.headingAnchors.has(destination.fragment)
        ) {
          errors.push(
            `${location} links to missing Markdown heading anchor "${destination.fragment}": ${link.url}`,
          );
        }
      }
    }
  }

  const readmePath = resolve(repositoryRoot, 'README.md');
  const readmeDocument = existsSync(readmePath) ? loadDocument(readmePath) : undefined;

  if (!existsSync(readmePath)) {
    errors.push('README.md is required.');
  } else if (readmeDocument !== undefined) {
    const statusSections = findStatusSections(readmeDocument);

    if (statusSections.length !== 1) {
      errors.push(
        `README.md must contain exactly one level-two Status section; found ${statusSections.length}.`,
      );
    } else {
      const [statusSection] = statusSections;
      if (hasUnsupportedStatusStructure(statusSection)) {
        errors.push('README.md Status must contain prose paragraphs only.');
      }

      const statusLinks = collectLinks(readmeDocument, statusSection);
      const resolvedStatusTargets = new Set();
      const allowedStatusTargets = new Set(requiredReadmeStatusTargets);

      for (const link of statusLinks) {
        if (link.kind === 'link' && readerVisiblePhrasingText(link.node).trim().length === 0) {
          errors.push('README.md Status authority links must have visible link text.');
          continue;
        }

        const destination = resolveDestination(repositoryRoot, readmePath, link.url);
        if (
          link.kind === 'link' &&
          destination.kind === 'local' &&
          allowedStatusTargets.has(destination.repositoryTarget)
        ) {
          resolvedStatusTargets.add(destination.repositoryTarget);
        } else {
          errors.push(
            `README.md Status may link only to ${requiredReadmeStatusTargets.join(' and ')}.`,
          );
        }
      }

      for (const requiredTarget of requiredReadmeStatusTargets) {
        if (!resolvedStatusTargets.has(requiredTarget)) {
          errors.push(`README.md Status must link to ${requiredTarget} as its authority source.`);
        }
      }
    }

    if (hasNumberedSliceProse(readmeDocument.tree)) {
      errors.push('README.md must not duplicate the rolling numbered-slice status.');
    }
  }

  return { errors, markdownFileCount: markdownFiles.length };
}
