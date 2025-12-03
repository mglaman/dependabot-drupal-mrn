const core = require('@actions/core');
const github = require('@actions/github');

/**
 * Fetches project tags from drupal-mrn API
 * @param {string} project - The Drupal project name
 * @returns {Promise<Array<string>>} Array of tag names
 */
async function fetchProjectTags(project) {
  try {
    const response = await fetch(`https://api.drupal-mrn.dev/project?project=${project}`);
    if (!response.ok) {
      core.warning(`Failed to fetch project tags for ${project}: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return (data.tags || []).map(tag => tag.name);
  } catch (error) {
    core.warning(`Error fetching project tags for ${project}: ${error.message}`);
    return [];
  }
}

/**
 * Maps a Semver version to the actual Git tag name
 * Handles legacy Drupal versioning (e.g., 1.38.0 -> 8.x-1.38)
 * @param {string} version - The Semver version (e.g., "1.38.0")
 * @param {Array<string>} tags - Array of available tag names
 * @returns {string} The mapped tag name or original version if no match found
 */
function mapVersionToTag(version, tags) {
  // First, check if the version exists as-is (for modern projects)
  if (tags.includes(version)) {
    return version;
  }

  // Try to match Semver pattern (e.g., 1.38.0 -> 8.x-1.38)
  // Match versions like 1.38.0, 1.40.0, etc.
  // Only check 8.x prefix since Semver was introduced after Drupal 8.
  const semverMatch = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (semverMatch) {
    const major = semverMatch[1];
    const minor = semverMatch[2];
    const legacyTag = `8.x-${major}.${minor}`;
    if (tags.includes(legacyTag)) {
      return legacyTag;
    }
  }

  // If no match found, return original version
  return version;
}

async function run() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const dependencyNames = process.env.DEPENDENCY_NAMES || '';
    const previousVersion = process.env.PREVIOUS_VERSION || '';
    const newVersion = process.env.NEW_VERSION || '';

    if (!token) {
      throw new Error('GITHUB_TOKEN is required');
    }

    // Handle grouped updates (comma-separated)
    const packages = dependencyNames.split(',').map(p => p.trim());
    const fromVersions = previousVersion.split(',').map(v => v.trim());
    const toVersions = newVersion.split(',').map(v => v.trim());

    // Filter to only drupal/ packages
    const drupalPackages = [];
    for (let i = 0; i < packages.length; i++) {
      if (packages[i].startsWith('drupal/')) {
        drupalPackages.push({
          name: packages[i],
          project: packages[i].replace('drupal/', ''),
          from: fromVersions[i] || fromVersions[0],
          to: toVersions[i] || toVersions[0]
        });
      }
    }

    if (drupalPackages.length === 0) {
      core.info('No drupal/ packages found in this PR');
      return;
    }

    // Fetch release notes for each package
    let releaseNotesSection = '\n\n---\n\n## Drupal Release Notes\n\n';
    let hasReleaseNotes = false;

    for (const pkg of drupalPackages) {
      core.info(`Fetching release notes for ${pkg.project} from ${pkg.from} to ${pkg.to}`);

      // Fetch project tags to map Semver versions to actual Git tags
      const tags = await fetchProjectTags(pkg.project);
      const mappedFrom = mapVersionToTag(pkg.from, tags);
      const mappedTo = mapVersionToTag(pkg.to, tags);

      if (mappedFrom !== pkg.from || mappedTo !== pkg.to) {
        core.info(`Mapped versions for ${pkg.project}: ${pkg.from} → ${mappedFrom}, ${pkg.to} → ${mappedTo}`);
      }

      const apiUrl = `https://api.drupal-mrn.dev/changelog?project=${pkg.project}&from=${mappedFrom}&to=${mappedTo}&format=json`;

      try {
        const response = await fetch(apiUrl);

        if (!response.ok) {
          core.warning(`API returned ${response.status} for ${pkg.project}`);
          releaseNotesSection += `### ${pkg.name}\n\n`;
          releaseNotesSection += `_Could not fetch release notes (${pkg.from} → ${pkg.to})_\n\n`;
          continue;
        }

        const data = await response.json();

        if (data && data.changes && data.changes.length > 0) {
          hasReleaseNotes = true;
          releaseNotesSection += `### ${pkg.name}\n\n`;

          // Add version info with link to release notes page and compare link
          // Use mapped versions for URLs, but show original versions in text
          const releaseNotesUrl = `https://www.drupal.org/project/${pkg.project}/releases/${mappedTo}`;
          const compareUrl = `https://git.drupalcode.org/project/${pkg.project}/-/compare/${mappedFrom}...${mappedTo}`;
          releaseNotesSection += `**${pkg.from} → [${pkg.to}](${releaseNotesUrl})** ([compare](${compareUrl}))\n\n`;

          // Changes are now pre-grouped and sorted by type in the API response
          for (const typeGroup of data.changes) {
            const type = typeGroup.type || 'Misc';
            if (!typeGroup.changes || typeGroup.changes.length === 0) {
              continue;
            }

            releaseNotesSection += `#### ${type}\n\n`;
            for (const change of typeGroup.changes) {
              // Use nid from JSON data to create the issue ID link
              const issueId = `#${change.nid}`;
              // Remove the issue ID prefix from summary (format: #12345: or #12345 by author:)
              // Match: #12345 followed by optional " by author" and then ": " or just ": "
              const summaryWithoutId = change.summary.replace(/^#[0-9]+(?:\s+by\s+[^:]+)?:\s*/, '');
              releaseNotesSection += `* [${issueId}](${change.link})${summaryWithoutId ? ': ' + summaryWithoutId : ''}\n`;
            }
            releaseNotesSection += '\n';
          }

          // Add change records if any
          if (data.changeRecords && data.changeRecords.length > 0) {
            releaseNotesSection += `#### Change Records\n\n`;
            for (const record of data.changeRecords) {
              // Handle both old format (link) and new format (url)
              const recordUrl = record.url || record.link;
              const recordTitle = record.title || record.summary;
              if (recordUrl && recordTitle) {
                releaseNotesSection += `* [${recordTitle}](${recordUrl})\n`;
              }
            }
            releaseNotesSection += '\n';
          }

          releaseNotesSection += '\n';
        } else {
          releaseNotesSection += `### ${pkg.name}\n\n`;
          const releaseNotesUrl = `https://www.drupal.org/project/${pkg.project}/releases/${mappedTo}`;
          releaseNotesSection += `**${pkg.from} → [${pkg.to}](${releaseNotesUrl})**\n\n`;
          releaseNotesSection += `_No release notes available_\n\n`;
        }
      } catch (error) {
        core.error(`Error fetching release notes for ${pkg.project}: ${error.message}`);
        releaseNotesSection += `### ${pkg.name}\n\n`;
        releaseNotesSection += `_Error fetching release notes: ${error.message}_\n\n`;
      }
    }

    if (!hasReleaseNotes) {
        core.info('No release notes were retrieved from the API.');
    }

    const octokit = github.getOctokit(token);
    const context = github.context;

    // Validate PR context
    if (!context.payload.pull_request || !context.payload.pull_request.number) {
      core.setFailed('This action must be run in the context of a pull request');
      return;
    }

    // Get current PR body
    const { data: pr } = await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number
    });

    // Check if we already added release notes (avoid duplicates on synchronize)
    if (pr.body && pr.body.includes('## Drupal Release Notes')) {
      core.info('Release notes already present in PR description');
      return;
    }

    // Update PR body with release notes
    const newBody = (pr.body || '') + releaseNotesSection;

    await octokit.rest.pulls.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      body: newBody
    });

    core.info('Successfully updated PR description with Drupal release notes');

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Only run if this file is executed directly (not when imported for testing)
if (require.main === module) {
  run();
}

module.exports = { run, fetchProjectTags, mapVersionToTag };
