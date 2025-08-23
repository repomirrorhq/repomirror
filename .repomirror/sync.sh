#!/bin/bash
cat .repomirror/prompt.md | \
        claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir /tmp/test-target2 | \
        tee -a .repomirror/claude_output.jsonl | \
        npx repomirror visualize --debug;