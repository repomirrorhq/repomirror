

### how it works

```
npx repomirror init 
```


generates a repomirror.yaml

```yaml
syncs:
  - source:
      path: ./
    target:
      repo: ../assistant-ui-vuejs
    instructions: |
      translate the react repo to vuejs
    agent: claude_code # or amp
```

```
npx repomirror sync-one
```

will do the following steps, with a big prompt into claude code headless or amp

```
- review everything in $SOURCE_REPO using as many subagents as possible, focus on understand:
    - the public interfaces
    - how information flows through the system
    - subagents must be prompted to return a list of files, line numbers, and how they are used in the system
    - inspiration from https://github.com/humanlayer/humanlayer/blob/main/.claude/commands/research_codebase.md
- review everything in $TARGET_REPO using as many subagents as possible, focus on understand:
    - ..
- pick the highest priority item from @IMPLEMENTATION_PLAN.md and implement the migration from ./ to ../assistant-ui-vuejs according to $INSTRUCTIONS
    - NEVER CHANGE THE SOURCE REPO, ONLY THE TARGET REPO
- ensure the tests and checks in the target repo
- update IMPLEMENTATION_PLAN.md with your progress
- commit the changes to the target repo 
```

while you're working, write any intermediate may be written to .repomirror/*.md

### other features

- sync_one.md - `npx repomirror sync-forever` runs one iteration of the loop rather than looping forever
- ./remote_sync.md - able to push/pull from remote repos instead of just two local dirs
- ./github_actions_install.md - `npx repomirror install-github` sets up github actions to do the sync on every pr merge
- ./issue_fixer.md - watch open issues in a loop  with research/plan/implement

