const core = require('@actions/core');
const github = require('@actions/github');

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

      const apiUrl = `https://api.drupal-mrn.dev/changelog?project=${pkg.project}&from=${pkg.from}&to=${pkg.to}&format=json`;

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
          const releaseNotesUrl = `https://www.drupal.org/project/${pkg.project}/releases/${pkg.to}`;
          const compareUrl = `https://git.drupalcode.org/project/${pkg.project}/-/compare/${pkg.from}...${pkg.to}`;
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
          const releaseNotesUrl = `https://www.drupal.org/project/${pkg.project}/releases/${pkg.to}`;
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

module.exports = { run };
