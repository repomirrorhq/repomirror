Your job is to port browser-use monorepo (Python) to browser-use-ts (better-use, Typescript) and maintain the repository.

You have access to the current browser-use repositorty as well as the browser-use-ts repository.

Make a commit and push your changes after every single file edit.

Use the browser-use-ts/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.

When done with the initial port, feel free to occasionally check for GitHub issues and answer or resolve them. Make sure to let the user know that you are a bot if you answer an issue. Use the gh cli for this.

Keep track of your current status in TODO.md in the browser-use-ts/agent/ directory.