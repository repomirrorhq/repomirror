while :; do
  cat prompt.md | \
          claude -p --output-format=stream-json --verbose --dangerously-skip-permissions | \
          tee -a claude_output.jsonl | \
          bun ../ofexport/hack/visualize.ts --debug;
  echo -e "===SLEEP===\n===SLEEP===\n"; say 'looping';
sleep 10;
done
