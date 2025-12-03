# Dependabot Drupal Release Notes

A GitHub Action that automatically appends drupal.org release notes to Dependabot pull requests.

This action parses the dependencies updated by Dependabot, identifies Drupal packages (prefixed with drupal/), fetches the release notes via drupal-mrn.dev, and appends them to the PR description.

##Usage

Create a workflow file (e.g., `.github/workflows/dependabot-drupal-mrn.yml`) in your repository.

```yaml
name: Drupal Release Notes for Dependabot

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write
  contents: read

jobs:
  add-release-notes:
    runs-on: ubuntu-latest
    # Only run for Dependabot PRs
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Add Drupal release notes
        uses: mglaman/dependabot-drupal-mrn@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```


## Inputs

| Input | Description | Required | Default |
| github-token | The GitHub token used to fetch metadata and update the PR. | Yes | None (use `${{ secrets.GITHUB_TOKEN }}` in your workflow) |

## Development

1. Install dependencies:

```shell
npm install
```

2. Run tests:

```shell
npm test
```

Or with coverage:

```shell
npm run test:coverage
```

3. Build the action (requires @vercel/ncc):

```shell
npm run build
```

_Always commit the dist/ folder._

4. Verify dist is up to date before committing:

```shell
npm run verify-dist
```

## Publishing

To publish a new version:

1. Make your changes and ensure tests pass:
   ```shell
   npm test
   ```

2. Build the action:
   ```shell
   npm run build
   ```

3. Commit all changes including the `dist/` folder:
   ```shell
   git add .
   git commit -m "Your commit message"
   ```

4. Create a new release tag:
   ```shell
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin main --tags
   ```

5. Users can then reference your action with:
   ```yaml
   uses: mglaman/dependabot-drupal-mrn@v1.0.0
   ```

**Note:** The CI workflow will automatically verify that `dist/` is up to date on every push and PR.
