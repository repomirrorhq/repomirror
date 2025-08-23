# Remote Repository Support Design

## Overview

This document outlines the design for adding remote repository push/pull support to the repomirror tool. The feature will enable users to:

1. Configure remote repositories for the transformed code
2. Push transformed changes to remote repositories 
3. Pull updates from source repositories and re-sync transformations
4. Manage multiple remote destinations for different branches/environments

## Current Architecture Analysis

The repomirror tool currently has these components:

- **CLI Entry Point**: `/src/cli.ts` - Commander.js based CLI with commands
- **Commands**: `/src/commands/` directory with individual command implementations
- **Configuration**: `repomirror.yaml` file for persistent configuration
- **Core Components**: 
  - `init` - Interactive setup with preflight checks
  - `sync` - Single transformation run using `.repomirror/sync.sh`
  - `sync-forever` - Continuous sync using `.repomirror/ralph.sh`
  - `visualize` - Stream JSON output visualization

### Current Flow
1. `init` creates `.repomirror/` directory with scripts and config
2. `sync` runs Claude transformations via shell scripts
3. Transformed code is written to target directory
4. Target directory must be a git repo with remotes (preflight check)

## Proposed New Commands

### 1. `remote` Command
**Purpose**: Manage remote repository configurations

```typescript
// Usage examples:
// npx repomirror remote add origin https://github.com/user/transformed-repo.git
// npx repomirror remote add staging https://github.com/user/staging-repo.git  
// npx repomirror remote list
// npx repomirror remote remove origin
```

**Implementation**: New file `/src/commands/remote.ts`

### 2. `push` Command  
**Purpose**: Push transformed changes to configured remotes

```typescript
// Usage examples:
// npx repomirror push                    # push to default remote (origin/main)
// npx repomirror push --remote staging   # push to specific remote
// npx repomirror push --branch feature/new-feature # push to specific branch
// npx repomirror push --all             # push to all configured remotes
```

**Implementation**: New file `/src/commands/push.ts`

### 3. `pull` Command
**Purpose**: Pull source changes and trigger re-sync

```typescript  
// Usage examples:
// npx repomirror pull                    # pull source changes and re-sync
// npx repomirror pull --source-only      # pull source without re-sync
// npx repomirror pull --sync-after       # pull and run sync-forever after
```

**Implementation**: New file `/src/commands/pull.ts`

## Configuration Changes

### Enhanced `repomirror.yaml`

```yaml
# Current fields
sourceRepo: "./src"
targetRepo: "../myproject-ts"
transformationInstructions: "convert python to typescript"

# New remote repository configuration
remotes:
  origin:
    url: "https://github.com/user/myproject-ts.git"
    branch: "main"
    auto_push: true          # auto-push after sync
  staging:
    url: "https://github.com/user/myproject-staging.git" 
    branch: "develop"
    auto_push: false
  
# New options
push:
  default_remote: "origin"   # default for push command
  default_branch: "main"     # default branch to push to
  commit_prefix: "[repomirror]"  # prefix for commit messages
  
pull:
  auto_sync: true           # automatically run sync after pull
  source_remote: "upstream" # remote name in source repo to pull from
  source_branch: "main"     # branch to pull from in source repo
```

### Configuration Schema Updates

The `RepoMirrorConfig` interface in `/src/commands/init.ts` needs expansion:

```typescript
interface RepoMirrorConfig {
  // Existing fields
  sourceRepo: string;
  targetRepo: string;
  transformationInstructions: string;
  
  // New remote configuration
  remotes?: {
    [remoteName: string]: {
      url: string;
      branch: string;
      auto_push?: boolean;
    };
  };
  
  // New push configuration
  push?: {
    default_remote?: string;
    default_branch?: string;
    commit_prefix?: string;
  };
  
  // New pull configuration  
  pull?: {
    auto_sync?: boolean;
    source_remote?: string;
    source_branch?: string;
  };
}
```

## Integration with Existing Commands

### Enhanced `init` Command
- Add remote configuration during setup
- Prompt for remote repository URLs
- Validate remote accessibility during preflight checks
- Update existing preflight checks to verify push permissions

### Enhanced `sync` Command
- Add `--push` flag to auto-push after sync
- Add `--remote <name>` flag to specify push destination
- Modify generated scripts to optionally include git operations

### Enhanced `sync-forever` Command  
- Add configuration option for auto-push after each sync
- Add failure handling for git operations
- Continue syncing even if push fails (with warnings)

## Git Operations Design

### Push Workflow
1. Check if target directory has uncommitted changes
2. Create commit with descriptive message (include source commit hash if available)
3. Push to specified remote/branch
4. Handle authentication failures gracefully
5. Support both HTTPS and SSH authentication

### Pull Workflow
1. Navigate to source repository 
2. Pull latest changes from specified remote/branch
3. Check if changes affect files that impact transformation
4. Optionally trigger re-sync based on configuration
5. Handle merge conflicts in source repository

### Commit Message Strategy
Format: `[repomirror] <transformation_summary> (source: <source_commit_hash>)`

Examples:
- `[repomirror] Update API transformations (source: abc123f)`
- `[repomirror] Convert authentication module to TypeScript (source: def456a)`

## Error Handling Considerations

### Authentication Failures
- Detect SSH key issues vs HTTPS credential issues
- Provide helpful error messages with setup instructions
- Support multiple authentication methods
- Graceful fallback when push fails

### Network Issues
- Retry logic with exponential backoff
- Offline mode detection
- Queue operations for later when connectivity returns

### Git State Issues
- Handle dirty working directory in target repo
- Resolve merge conflicts in source repo pulls
- Handle detached HEAD states
- Branch switching and creation

### Sync Integration Errors
- Continue sync-forever even if push fails
- Log failures without stopping the sync process
- Provide option to disable auto-push on repeated failures

## Implementation Plan

### Phase 1: Core Remote Management
1. Create `remote` command for adding/listing/removing remotes
2. Update configuration schema and init command
3. Add configuration validation and loading functions

### Phase 2: Push Functionality  
1. Create `push` command with basic push operations
2. Add commit message generation
3. Integrate with sync commands (optional auto-push)
4. Add authentication and error handling

### Phase 3: Pull Functionality
1. Create `pull` command for source repository updates
2. Add change detection and sync triggering
3. Integrate with sync-forever workflow
4. Add conflict resolution guidance

### Phase 4: Enhanced Integration
1. Enhance sync scripts with git operations
2. Add branch management features
3. Add multi-remote push support
4. Performance optimizations and caching

## File Structure Changes

```
src/commands/
├── init.ts          # Enhanced with remote config
├── sync.ts          # Enhanced with push options  
├── sync-forever.ts  # Enhanced with auto-push
├── sync-one.ts      # (unchanged)
├── visualize.ts     # (unchanged)
├── remote.ts        # NEW: Remote management
├── push.ts          # NEW: Push operations
└── pull.ts          # NEW: Pull operations

src/lib/             # NEW: Shared utilities
├── git.ts           # Git operation helpers
├── config.ts        # Configuration management
└── auth.ts          # Authentication helpers
```

## Testing Strategy

### Unit Tests
- Mock git operations using `execa` mocks
- Test configuration validation and loading
- Test error handling scenarios
- Test command parsing and validation

### Integration Tests  
- Test with real git repositories (using temp directories)
- Test authentication flows
- Test sync integration with git operations
- Test error recovery scenarios

### End-to-End Tests
- Full workflow tests with mock remote repositories
- Test interaction between commands
- Test configuration persistence
- Test sync-forever with git operations

## Security Considerations

### Credential Management
- Never store credentials in configuration files
- Use git credential helpers
- Support SSH key authentication
- Provide clear documentation for authentication setup

### Repository Access
- Validate remote URLs before adding
- Check push permissions during setup
- Handle private repository access
- Support organization/team repository patterns

## CLI Updates

### New Command Structure
```bash
# Remote management
repomirror remote add <name> <url> [--branch <branch>]
repomirror remote list
repomirror remote remove <name>
repomirror remote set-url <name> <url>

# Push operations  
repomirror push [--remote <name>] [--branch <branch>] [--all]
repomirror push --dry-run    # show what would be pushed

# Pull operations
repomirror pull [--source-only] [--sync-after]
repomirror pull --check      # check for source changes without pulling

# Enhanced existing commands
repomirror sync --push [--remote <name>]
repomirror sync-forever --auto-push
repomirror init --remote <url>  # add remote during init
```

### Help Text Updates
Update CLI help text and `--help` output to document new remote repository features and workflow examples.

## Migration Strategy

### Backward Compatibility
- All new features are optional
- Existing workflows continue unchanged
- Configuration files are upgraded automatically
- Graceful degradation when remotes not configured

### Upgrade Path
1. Existing users can add remotes via `repomirror remote add`
2. Configuration file is automatically migrated on first use
3. New features are opt-in via flags or configuration
4. Clear documentation for migrating existing setups

## Success Metrics

### Functionality Metrics  
- Commands execute without errors in common scenarios
- Git operations handle authentication correctly
- Sync integration works smoothly with push operations
- Error messages are helpful and actionable

### Performance Metrics
- Push operations complete in reasonable time
- Sync-forever remains responsive with auto-push enabled
- Pull operations detect changes efficiently
- No significant performance regression in existing commands

This design provides a comprehensive foundation for adding remote repository support while maintaining the existing architecture and user experience. The phased implementation allows for iterative development and testing of each component.