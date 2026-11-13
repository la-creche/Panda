const TAG_PREFIX = 'panda-v';
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(value, label) {
  const match = VERSION_PATTERN.exec(value);
  if (!match) throw new Error(`${label} must be an x.y.z version: ${value}`);

  const version = match.slice(1).map(Number);
  if (version.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`${label} is outside JavaScript's safe integer range: ${value}`);
  }
  return version;
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function formatVersion(version) {
  return version.join('.');
}

/**
 * Plans one immutable release tag. The package version is the deliberate
 * major/minor floor; otherwise every successful main build advances patch.
 */
export function nextReleaseTag(baseValue, tags) {
  const base = parseVersion(baseValue, 'package version');
  const versions = tags.map((tag) => {
    if (!tag.startsWith(TAG_PREFIX)) {
      throw new Error(`release tag must start with ${TAG_PREFIX}: ${tag}`);
    }
    return parseVersion(tag.slice(TAG_PREFIX.length), 'release tag');
  });

  if (versions.length === 0) return `${TAG_PREFIX}${formatVersion(base)}`;

  const latest = versions.reduce((left, right) => (
    compareVersions(left, right) >= 0 ? left : right
  ));
  if (compareVersions(base, latest) > 0) {
    return `${TAG_PREFIX}${formatVersion(base)}`;
  }

  const nextPatch = latest[2] + 1;
  if (!Number.isSafeInteger(nextPatch)) throw new Error('release patch version overflowed');
  return `${TAG_PREFIX}${formatVersion([latest[0], latest[1], nextPatch])}`;
}

if (process.argv[1]?.endsWith('next-release-tag.mjs')) {
  const [, , baseValue, ...tags] = process.argv;
  if (!baseValue) {
    console.error('usage: node scripts/next-release-tag.mjs <base-version> [panda-vX.Y.Z ...]');
    process.exitCode = 2;
  } else {
    try {
      console.log(nextReleaseTag(baseValue, tags));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
