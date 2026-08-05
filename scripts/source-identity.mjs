import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { log } from 'node:console';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const defaultReviewExclusion = 'docs/reviews/m1-completion-review.md';

function selectedReviewExclusion(arguments_) {
  if (arguments_.length === 0) {
    return defaultReviewExclusion;
  }
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== '--review-exclusion' ||
    !/^docs\/reviews\/[a-z0-9][a-z0-9-]*\.md$/u.test(arguments_[1] ?? '')
  ) {
    throw new TypeError('Usage: source-identity.mjs [--review-exclusion docs/reviews/<review>.md]');
  }
  return arguments_[1];
}

const reviewExclusion = selectedReviewExclusion(process.argv.slice(2));

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
}

const paths = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  .split('\0')
  .filter((path) => path.length !== 0 && path !== reviewExclusion)
  .sort();
const manifest = createHash('sha256');
manifest.update('codeclosure-source-manifest-v1\0', 'utf8');
for (const path of paths) {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    manifest.update(`deleted\0${path}\0`, 'utf8');
    continue;
  }
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(absolutePath);
    const contentDigest = createHash('sha256').update(target, 'utf8').digest('hex');
    manifest.update(`symlink\0${path}\0${contentDigest}\0`, 'utf8');
  } else if (stat.isFile()) {
    const contentDigest = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
    const executable = (stat.mode & 0o111) === 0 ? 'regular' : 'executable';
    manifest.update(`${executable}\0${path}\0${contentDigest}\0`, 'utf8');
  } else {
    throw new TypeError(`Git-listed source is not a file or symbolic link: ${path}`);
  }
}

const status = git(['status', '--porcelain=v1']);
log(`Base Git revision: ${git(['rev-parse', 'HEAD']).trim()}`);
log(`Git branch: ${git(['branch', '--show-current']).trim() || 'DETACHED'}`);
log(`Working tree state: ${status.length === 0 ? 'clean' : 'modified'}`);
log(`Source manifest schema: codeclosure-source-manifest-v1`);
log(`Source manifest paths: ${paths.length}`);
log(`Source manifest digest: sha256:${manifest.digest('hex')}`);
log(`Self-referential review exclusion: ${reviewExclusion}`);
