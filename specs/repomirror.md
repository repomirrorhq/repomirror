run repomirror init

one line use prompt that asks 

```
I'll help you maintain a transformed copy of this repo:

Source Repo you want to tckransform: [..] # note 0
Where do you want to transform code to: [..] # note 1
What changes do you want to make: [e.g. "translate this python repo to typescript"] 
```

note 0 - the default source repo is the current directory `./`
note 1 - the default transform directory is `../REPONAME-transformed`

all prompts should be loadable from a repomirror.yaml file if present,
or settable with a command line flag. `repomirror help` or `--help` should explain how this works and the available options.

- all prompts/cli flags are stashed to a repomirror.yaml during setup, and defaults are populated from the yaml file if present (instead of core defaults)


preflight checks

- ensure the target directory exists
- ensure the target directory is initialized as a git repo
- ensure the target directory has at least one upstream
- ensure the user has a configured claude code profile (e.g. `claude -p "say hi" and ensure the output contains "hi" or "Hi")

The preflight checks should print output about what they are doing and what they are checking.

### Background: Claude sdk:

```
import { query } from "@anthropic-ai/claude-code";

// IMPORTANT: Handle all message types to avoid hanging
// The loop will wait forever if you don't handle errors or check for completion
for await (const message of query({
  prompt: "...PROMPT...",
})) {
  if (message.type === "result") {
    if (message.is_error) {
      // Handle error case - MUST break or throw to avoid hanging
      throw new Error(message.result || "Claude SDK error");
    }
    console.log(message.result);
    break; // Exit loop after getting result
  }
  // Consider adding timeout or other message type handlers
}
```

### step 1

use the claude sdk to read files and generate a prompt 

**CRITICAL IMPLEMENTATION NOTE**: The Claude SDK async iterator can hang indefinitely if not properly handled. Ensure:
1. Always break the loop after receiving a valid result
2. Handle error cases explicitly (check `is_error` flag)
3. Consider implementing a timeout mechanism
4. Store the result and break immediately - don't continue iterating

where PROMPT conveys:

```
your task is to generate an optimized prompt for repo transformation. The prompt should match the format of the examples below.

<example 1>
Your job is to port [SOURCE PATH] monorepo (for react) to [TARGET PATH] (for vue) and maintain the repository.

You have access to the current [SOURCE PATH] repository as well as the [TARGET PATH] repository.

Make a commit and push your changes after every single file edit.

Use the [TARGET_PATH]/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.
</example 1>

<example 2>
Your job is to port browser-use monorepo (Python) to browser-use-ts (Typescript) and maintain the repository.

You have access to the current [SOURCE PATH] repository as well as the target [TARGET_PATH] repository.

Make a commit and push your changes after every single file edit.

Use the [TARGET PATH]/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.
</example 2>

The users instructions for transformation are:

<user instructions from question 2 above>

Your Job:

When you are ready, respond with EXACTLY the prompt matching the example, tailored for following the users' instructions and nothing else.

You should follow the format EXACTLY, filling in information based on what you learn from a CURSORY exploration of the source repo (this directory). Ensure you ONLY use the read tools (Read, Search, Grep, LS, Glob, etc) to explore the repo. You only need enough sense to build a good prompt, so dont use subagents.
```

### step 2

run claude code with the SDK using the prompt you generated with templating.

As you are building you may need to test the phrasing to get claude to output 

### step 3 

add the following files to the source repo in .repomirror/

- .repomirror/prompt.md # contents from the prompt
- .repomirror/sync.sh
- .repomirror/ralph.sh
- .repomirror/.gitignore

.repomirror/.gitignore has the exact below contents:
```
claude_output.jsonl
```

sync.sh has the exact below contents:
```
cat .repomirror/prompt.md | \
        claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir PATH_TO_TARGET_REPO | \
        tee -a .repomirror/claude_output.jsonl | \
        npx repomirror visualize --debug;
```

ralph.sh has the exact below contents:

```
while :; do
  ./sync.sh
  echo -e "===SLEEP===\n===SLEEP===\n"; echo 'looping';
sleep 10;
done
```

visualize command is a cli command that uses the exact same logic in the hack/visualize.ts file.

The shell scripts are included in the npm dist/ bundle and baked into the package so they can be copied out of the package root by `npx repomirror init` cli command.

**NOTE** - the above commands are sketches, you may find you need to adjust them to fit together well or to improve usability or reduce error-proneness.

### step 4

Output instructions to the user about next steps to run the commands

```
run `npx repomirror sync` - this will run the sync.sh script  once

run `npx repomirror sync-forever` - this will run the ralph.sh script, working forever to implement all the changes. 

The following files were created and safe to commit. Edit prompt.md as you see fit, but you probably dont want to run these files directly

- .repomirror/prompt.md # prompt
- .repomirror/sync.sh 
- .repomirror/ralph.sh 
- .repomirror/.gitignore 
```

### INIT CLI NOTES

- if .repomirror already exists, prompt the user if they want to overwrite the existing .repomirror/ directory. Flag to `--overwrite` to force overwrite.