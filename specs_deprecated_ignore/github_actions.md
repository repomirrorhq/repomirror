
```
npx repomirror setup-github
```

```
I'll help you set up a github actions workflow that will run the sync-one command on every pr merge


Target repo, e.g. 

Times to loop (advanced, recommend 3): [3]
```






setup-github will create a github actions workflow that will run the sync-one command on every pr merge

the key step in the github action


It will prompt the user for followup steps:

- push to github
- add secrets for ANTHROPIC_API_KEY and GITHUB_TOKEN, where GITHUB_TOKEN has read/push access to the target repo


the workflow will run 