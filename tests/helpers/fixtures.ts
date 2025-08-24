/**
 * Test fixtures and mock data for repomirror tests
 */

export const mockRepoConfig = {
  sourceRepo: "./",
  targetRepo: "../target",
  transformationInstructions: "transform python to typescript",
};

export const mockTransformationPrompt = `Your job is to port ./ monorepo (Python) to ../target (TypeScript) and maintain the repository.

You have access to the current ./ repository as well as the ../target repository.

Make a commit and push your changes after every single file edit.

Use the ../target/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.`;

export const mockSyncScript = `#!/bin/bash
cat .simonsays/prompt.md | \\
        claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir ../target | \\
        tee -a .simonsays/claude_output.jsonl | \\
        npx simonsays visualize --debug;`;

export const mockRalphScript = `#!/bin/bash
while :; do
  ./.simonsays/sync.sh
  echo -e "===SLEEP===\\n===SLEEP===\\n"; echo 'looping';
  sleep 10;
done`;

export const mockGitConfig = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
\tlogallrefupdates = true
[remote "origin"]
\turl = https://github.com/test/repo.git
\tfetch = +refs/heads/*:refs/remotes/origin/*`;

export const mockFileStructure = {
  "package.json": JSON.stringify({
    name: "test-repo",
    version: "1.0.0",
    description: "Test repository"
  }, null, 2),
  "README.md": "# Test Repository\n\nThis is a test repository.",
  "src": {
    "index.ts": "export function hello() { return 'world'; }",
    "utils": {
      "helper.ts": "export function helper() { return true; }"
    }
  }
};

export const mockClaudeOutput = {
  type: "result",
  is_error: false,
  result: mockTransformationPrompt
};

export const mockCommandResponses = {
  "git rev-parse --git-dir": { stdout: ".git", exitCode: 0 },
  "git remote -v": { 
    stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
    exitCode: 0 
  },
  "claude": { stdout: "Hi there! How can I help you today?", exitCode: 0 }
};

export const mockInquirerResponses = {
  sourceRepo: "./",
  targetRepo: "../target", 
  transformationInstructions: "transform python to typescript"
};