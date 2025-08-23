✅ validate init: [COMPLETED]

- create a temp dir for source repo and add a "hello.ts" file in it ✅
- create a temp dir for target and init a git repo in it ✅
- use `repomirror init` to test, use a "translate this repo to python" ✅
- ensure that the command succeeds and generated the correct files ✅

Validation completed successfully using hack/ralph-validate.sh script.
Results:
- repomirror.yaml created in source directory
- .repomirror/ directory created with all required files (prompt.md, sync.sh, ralph.sh, .gitignore)
- Command handles CLI flags correctly (--source, --target, --instructions)
- Test mode support added with SKIP_CLAUDE_TEST environment variable for automated testing
