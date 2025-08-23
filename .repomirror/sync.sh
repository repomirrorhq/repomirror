#!/bin/bash
cat .repomirror/prompt.md | \
        claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir /var/folders/38/3tndpln553v6d6xs9pfy69s40000gn/T/tmp.I7A9PPTqlI | \
        tee -a .repomirror/claude_output.jsonl | \
        npx repomirror visualize --debug;