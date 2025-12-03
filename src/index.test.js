const { run } = require('./index');
const core = require('@actions/core');
const github = require('@actions/github');

// Mock dependencies
jest.mock('@actions/core');
jest.mock('@actions/github');

// Mock global fetch
global.fetch = jest.fn();

describe('Dependabot Drupal Release Notes Action', () => {
  let mockOctokit;
  let mockContext;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    global.fetch.mockClear();

    // Setup default context
    mockContext = {
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      },
      payload: {
        pull_request: {
          number: 123
        }
      }
    };

    // Setup default octokit mock
    mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn(),
          update: jest.fn()
        }
      }
    };

    github.getOctokit = jest.fn(() => mockOctokit);
    github.context = mockContext;

    // Setup default environment
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.DEPENDENCY_NAMES = '';
    process.env.PREVIOUS_VERSION = '';
    process.env.NEW_VERSION = '';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.DEPENDENCY_NAMES;
    delete process.env.PREVIOUS_VERSION;
    delete process.env.NEW_VERSION;
  });

  describe('Error handling', () => {
    it('should fail if GITHUB_TOKEN is missing', async () => {
      delete process.env.GITHUB_TOKEN;

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('GITHUB_TOKEN is required');
    });

    it('should fail if not in PR context', async () => {
      process.env.DEPENDENCY_NAMES = 'drupal/core';
      process.env.PREVIOUS_VERSION = '10.0.0';
      process.env.NEW_VERSION = '10.1.0';
      mockContext.payload.pull_request = null;

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('This action must be run in the context of a pull request');
    });

    it('should fail if PR number is missing', async () => {
      process.env.DEPENDENCY_NAMES = 'drupal/core';
      process.env.PREVIOUS_VERSION = '10.0.0';
      process.env.NEW_VERSION = '10.1.0';
      mockContext.payload.pull_request = {};

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('This action must be run in the context of a pull request');
    });
  });

  describe('Package filtering', () => {
    it('should skip when no drupal/ packages are found', async () => {
      process.env.DEPENDENCY_NAMES = 'some/package,another/package';
      process.env.PREVIOUS_VERSION = '1.0.0,2.0.0';
      process.env.NEW_VERSION = '1.1.0,2.1.0';

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: 'Existing PR body' }
      });

      await run();

      expect(core.info).toHaveBeenCalledWith('No drupal/ packages found in this PR');
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('should filter to only drupal/ packages', async () => {
      process.env.DEPENDENCY_NAMES = 'drupal/core,some/other-package,drupal/token';
      process.env.PREVIOUS_VERSION = '10.0.0,1.0.0,1.0.0';
      process.env.NEW_VERSION = '10.1.0,1.1.0,1.1.0';

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: 'Existing PR body' }
      });

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [{
              type: 'Bug',
              changes: [{ nid: '1', link: 'https://www.drupal.org/i/1', type: 'Bug', summary: '#1: Core bug' }]
            }],
            changeRecords: []
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [{
              type: 'Task',
              changes: [{ nid: '2', link: 'https://www.drupal.org/i/2', type: 'Task', summary: '#2: Token task' }]
            }],
            changeRecords: []
          })
        });

      await run();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.drupal-mrn.dev/changelog?project=core&from=10.0.0&to=10.1.0&format=json'
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.drupal-mrn.dev/changelog?project=token&from=1.0.0&to=1.1.0&format=json'
      );
    });
  });

  describe('Release notes fetching', () => {
    beforeEach(() => {
      process.env.DEPENDENCY_NAMES = 'drupal/core';
      process.env.PREVIOUS_VERSION = '10.0.0';
      process.env.NEW_VERSION = '10.1.0';

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: 'Existing PR body' }
      });
    });

    it('should successfully fetch and append release notes', async () => {
      const mockData = {
        from: '10.0.0',
        to: '10.1.0',
        changes: [
          {
            type: 'Bug',
            changes: [
              {
                nid: '12345',
                link: 'https://www.drupal.org/i/12345',
                type: 'Bug',
                summary: '#12345: Fixed a bug'
              }
            ]
          },
          {
            type: 'Task',
            changes: [
              {
                nid: '12346',
                link: 'https://www.drupal.org/i/12346',
                type: 'Task',
                summary: '#12346: Completed a task'
              }
            ]
          }
        ],
        changeRecords: []
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockData
      });

      await run();

      expect(core.info).toHaveBeenCalledWith('Fetching release notes for core from 10.0.0 to 10.1.0');
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('## Drupal Release Notes')
      });
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('### drupal/core')
      });
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('**10.0.0 → [10.1.0](https://www.drupal.org/project/core/releases/10.1.0)**')
      });
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('[compare](https://git.drupalcode.org/project/core/-/compare/10.0.0...10.1.0)')
      });
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('#### Bug')
      });
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('[#12345](https://www.drupal.org/i/12345): Fixed a bug')
      });
    });

    it('should generate markdown output matching expected format', async () => {
      // Using redis example data structure with new grouped format
      const mockData = {
        from: '8.x-1.8',
        to: '8.x-1.9',
        changes: [
          {
            type: 'Bug',
            changes: [
              {
                nid: '3352651',
                link: 'https://www.drupal.org/i/3352651',
                type: 'Bug',
                summary: '#3352651 by grimreaper, _pratik_: redis.admin_display route not found'
              },
              {
                nid: '3494308',
                link: 'https://www.drupal.org/i/3494308',
                type: 'Bug',
                summary: '#3494308 by berdir, pgndrupal: FATAL "Service "queue.redis(_reliable)" not found" error when setting `queue_default`'
              }
            ]
          },
          {
            type: 'Task',
            changes: [
              {
                nid: '3493855',
                link: 'https://www.drupal.org/i/3493855',
                type: 'Task',
                summary: '#3493855: Relay tests are broken'
              },
              {
                nid: '3498940',
                link: 'https://www.drupal.org/i/3498940',
                type: 'Task',
                summary: '#3498940 by berdir: Optimize bin cache tags and last write timetamp'
              },
              {
                nid: '3500680',
                link: 'https://www.drupal.org/i/3500680',
                type: 'Task',
                summary: '#3500680 by berdir: Allow to remove support for invalidateAll() and treat it as deleteAll()'
              }
            ]
          }
        ],
        changeRecords: []
      };

      process.env.DEPENDENCY_NAMES = 'drupal/redis';
      process.env.PREVIOUS_VERSION = '8.x-1.8';
      process.env.NEW_VERSION = '8.x-1.9';

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockData
      });

      await run();

      const updateCall = mockOctokit.rest.pulls.update.mock.calls[0][0];
      const generatedMarkdown = updateCall.body;

      // Show the generated markdown output
      console.log('\n=== Generated Markdown Output ===');
      console.log(generatedMarkdown);
      console.log('=== End of Markdown Output ===\n');

      // Verify structure
      expect(generatedMarkdown).toContain('## Drupal Release Notes');
      expect(generatedMarkdown).toContain('### drupal/redis');
      expect(generatedMarkdown).toContain('**8.x-1.8 → [8.x-1.9](https://www.drupal.org/project/redis/releases/8.x-1.9)**');
      expect(generatedMarkdown).toContain('[compare](https://git.drupalcode.org/project/redis/-/compare/8.x-1.8...8.x-1.9)');
      expect(generatedMarkdown).toContain('#### Bug');
      expect(generatedMarkdown).toContain('#### Task');
      expect(generatedMarkdown).toContain('* [#3493855](https://www.drupal.org/i/3493855): Relay tests are broken');
      expect(generatedMarkdown).toContain('* [#3352651](https://www.drupal.org/i/3352651): redis.admin_display route not found');

      // Verify there's no separate Contributors section (contributors may appear in issue summaries, which is fine)
      expect(generatedMarkdown).not.toContain('### Contributors');
      expect(generatedMarkdown).not.toContain('Contributors (');

      // Verify the structure matches expected format - only issue ID should be linked
      expect(generatedMarkdown).toContain('* [#3493855](https://www.drupal.org/i/3493855): Relay tests are broken');
      expect(generatedMarkdown).toContain('* [#3352651](https://www.drupal.org/i/3352651): redis.admin_display route not found');
    });

    it('should handle API errors gracefully', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      await run();

      expect(core.warning).toHaveBeenCalledWith('API returned 404 for core');
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('_Could not fetch release notes (10.0.0 → 10.1.0)_')
      });
    });

    it('should handle empty release notes', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ changes: [], changeRecords: [] })
      });

      await run();

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('_No release notes available_')
      });
      expect(core.info).toHaveBeenCalledWith('No release notes were retrieved from the API.');
    });

    it('should handle fetch errors', async () => {
      const errorMessage = 'Network error';
      global.fetch.mockRejectedValue(new Error(errorMessage));

      await run();

      expect(core.error).toHaveBeenCalledWith(`Error fetching release notes for core: ${errorMessage}`);
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining(`_Error fetching release notes: ${errorMessage}_`)
      });
    });
  });

  describe('Grouped updates', () => {
    it('should handle multiple packages with grouped versions', async () => {
      process.env.DEPENDENCY_NAMES = 'drupal/core,drupal/token';
      process.env.PREVIOUS_VERSION = '10.0.0,1.0.0';
      process.env.NEW_VERSION = '10.1.0,1.1.0';

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: 'Existing PR body' }
      });

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [{
              type: 'Bug',
              changes: [{ nid: '1', link: 'https://www.drupal.org/i/1', type: 'Bug', summary: '#1: Core bug' }]
            }],
            changeRecords: []
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [{
              type: 'Task',
              changes: [{ nid: '2', link: 'https://www.drupal.org/i/2', type: 'Task', summary: '#2: Token task' }]
            }],
            changeRecords: []
          })
        });

      await run();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('### drupal/core')
      });
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('### drupal/token')
      });
    });

    it('should handle single version for multiple packages (fallback behavior)', async () => {
      process.env.DEPENDENCY_NAMES = 'drupal/core,drupal/token';
      process.env.PREVIOUS_VERSION = '10.0.0';
      process.env.NEW_VERSION = '10.1.0';

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: 'Existing PR body' }
      });

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [{
              type: 'Bug',
              changes: [{ nid: '1', link: 'https://www.drupal.org/i/1', type: 'Bug', summary: '#1: Core bug' }]
            }],
            changeRecords: []
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changes: [{
              type: 'Task',
              changes: [{ nid: '2', link: 'https://www.drupal.org/i/2', type: 'Task', summary: '#2: Token task' }]
            }],
            changeRecords: []
          })
        });

      await run();

      // Both should use the same version (fallback to first)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.drupal-mrn.dev/changelog?project=core&from=10.0.0&to=10.1.0&format=json'
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.drupal-mrn.dev/changelog?project=token&from=10.0.0&to=10.1.0&format=json'
      );
    });
  });

  describe('Duplicate prevention', () => {
    it('should not update PR if release notes already exist', async () => {
      process.env.DEPENDENCY_NAMES = 'drupal/core';
      process.env.PREVIOUS_VERSION = '10.0.0';
      process.env.NEW_VERSION = '10.1.0';

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: 'Existing PR body\n\n## Drupal Release Notes\n\nAlready here' }
      });

      await run();

      expect(core.info).toHaveBeenCalledWith('Release notes already present in PR description');
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('should update PR if release notes do not exist', async () => {
      process.env.DEPENDENCY_NAMES = 'drupal/core';
      process.env.PREVIOUS_VERSION = '10.0.0';
      process.env.NEW_VERSION = '10.1.0';

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: 'Existing PR body without release notes' }
      });

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          changes: [{
            type: 'Bug',
            changes: [{ nid: '1', link: 'https://www.drupal.org/i/1', type: 'Bug', summary: '#1: Bug fix' }]
          }],
          changeRecords: []
        })
      });

      await run();

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalled();
    });
  });

  describe('PR body handling', () => {
    beforeEach(() => {
      process.env.DEPENDENCY_NAMES = 'drupal/core';
      process.env.PREVIOUS_VERSION = '10.0.0';
      process.env.NEW_VERSION = '10.1.0';

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          changes: [{
            type: 'Bug',
            changes: [{ nid: '1', link: 'https://www.drupal.org/i/1', type: 'Bug', summary: '#1: Bug fix' }]
          }],
          changeRecords: []
        })
      });
    });

    it('should handle PR with no existing body', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: null }
      });

      await run();

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringContaining('## Drupal Release Notes')
      });
    });

    it('should append to existing PR body', async () => {
      const existingBody = 'Original PR description';
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { body: existingBody }
      });

      await run();

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: expect.stringMatching(new RegExp(`^${existingBody.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
      });
    });
  });
});

