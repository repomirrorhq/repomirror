#!/bin/bash

echo "Testing repomirror init command validation"
echo "=========================================="

# Create temp directories
SOURCE_DIR=$(mktemp -d)
TARGET_DIR=$(mktemp -d)

echo "Source dir: $SOURCE_DIR"
echo "Target dir: $TARGET_DIR"

# Setup source repo with hello.ts
echo 'console.log("Hello World");' > "$SOURCE_DIR/hello.ts"
echo "Created hello.ts in source directory"

# Setup target repo as git repo with remote
cd "$TARGET_DIR"
git init
git remote add origin https://github.com/example/test.git
cd - > /dev/null

echo ""
echo "Running repomirror init..."
echo ""

# Run repomirror init from the source directory
cd "$SOURCE_DIR"
SKIP_CLAUDE_TEST=true timeout 30s node /Users/dex/go/src/github.com/dexhorthy/repomirror/dist/cli.js init \
  --source "$SOURCE_DIR" \
  --target "$TARGET_DIR" \
  --instructions "translate this typescript repo to python"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
  echo ""
  echo "❌ Command timed out after 30 seconds"
  echo "Issue: The Claude SDK call in generateTransformationPrompt is hanging"
  echo ""
  echo "The problem is in src/commands/init.ts lines 319-332:"
  echo "- The async iterator is not properly handling all message types"
  echo "- Need to add timeout or better error handling"
  exit 1
elif [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo "✅ Init command completed successfully"
  
  # Check if required files were created
  if [ -f "$SOURCE_DIR/repomirror.yaml" ]; then
    echo "✅ repomirror.yaml created"
  else
    echo "❌ repomirror.yaml not created"
  fi
  
  if [ -d "$SOURCE_DIR/.repomirror" ]; then
    echo "✅ .repomirror directory created"
    
    # Check individual files
    for file in prompt.md sync.sh ralph.sh .gitignore; do
      if [ -f "$SOURCE_DIR/.repomirror/$file" ]; then
        echo "  ✅ $file created"
      else
        echo "  ❌ $file not created"
      fi
    done
  else
    echo "❌ .repomirror directory not created"
  fi
else
  echo ""
  echo "❌ Command failed with exit code $EXIT_CODE"
fi

# Cleanup
rm -rf "$SOURCE_DIR" "$TARGET_DIR"