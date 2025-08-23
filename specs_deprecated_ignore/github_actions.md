## PR Sync

```
npx repomirror setup-github-pr-sync
```

```
I'll help you set up a github actions workflow that will run the sync-one command on every pr merge


Target repo, e.g. repomirrorhq/repomirror:
Times to loop (advanced, recommend 3): [3]
```

Flags `--target-repo` and `--times-to-loop`

creates .github/workflows/repomirror.yml

target-repo and times-to-loop are persisted to repomirror.yaml similar to other flags and loaded as defaults when running the `setup-github-pr-sync` command.

if already present, prompts "want to overwrite?" - exits if no. flag --overwrite to force overwrite.

setup-github-pr-sync will create a github actions workflow that will run the sync-one command on every pr merge


It will prompt the user for followup steps:

- push to github
- add secrets for ANTHROPIC_API_KEY and GITHUB_TOKEN, where GITHUB_TOKEN has read/push access to the target repo


the workflow will always have a workflow_dispatch trigger, and an optional push trigger.

the workflow will install repomirror and run the sync-one command in a loop N times


### dispatch sync

```
npx repomirror dispatch-sync
```

will check to ensure the workflow exists and is present in the current repo.

will dispatch a workflow_dispatch event to the repomirror.yml workflow using the `gh` cli

```

this will prompt the user, describing what's gonna happen and get confirmation. a `-y` `--yes` flag will skip the confirmation prompt. A `--quiet` `-q` flag will suppress output. Quiet cannot be used without --yes, but --yes can be used without --quiet.









