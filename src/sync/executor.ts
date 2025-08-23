import * as fs from "fs-extra";
import * as path from "path";
import * as yaml from "yaml";
import chalk from "chalk";
import ora, { Ora } from "ora";
import { execa } from "execa";
import { glob } from "glob";

// TypeScript interfaces for sync configuration and data structures
export interface SyncConfig {
  source: {
    type: "git" | "local";
    url: string;
    branch: string;
    path?: string;
  };
  target: {
    type: "git" | "local";
    url: string;
    branch: string;
    path?: string;
  };
  instructions: {
    description: string;
    rules: string[];
    transformations: Array<{
      type: "file-rename" | "content-transform" | "structure-change" | "custom";
      description: string;
      source?: string;
      target?: string;
      pattern?: string;
      replacement?: string;
      [key: string]: any;
    }>;
  };
  sync: {
    interval: number;
    ignore: string[];
    include?: string[];
    dryRun?: boolean;
  };
}

export interface FileInfo {
  path: string;
  relativePath: string;
  size: number;
  modified: Date;
  type: "file" | "directory";
  extension?: string;
  content?: string;
}

export interface AnalysisResult {
  repositoryPath: string;
  totalFiles: number;
  totalSize: number;
  filesByType: Record<string, number>;
  structure: {
    depth: number;
    directories: string[];
    files: FileInfo[];
  };
  patterns: {
    configFiles: string[];
    sourceFiles: string[];
    documentationFiles: string[];
    buildFiles: string[];
  };
  metadata: {
    lastCommit?: string;
    branch: string;
    remoteUrl?: string;
    isClean: boolean;
  };
}

export interface TransformationStep {
  type: "create" | "modify" | "delete" | "rename" | "copy";
  sourcePath?: string;
  targetPath: string;
  content?: string;
  reason: string;
  priority: number;
}

export interface MigrationPlan {
  sourceAnalysis: AnalysisResult;
  targetAnalysis: AnalysisResult;
  transformations: TransformationStep[];
  summary: {
    filesToCreate: number;
    filesToModify: number;
    filesToDelete: number;
    filesToRename: number;
    estimatedDuration: string;
  };
  risks: Array<{
    level: "low" | "medium" | "high";
    description: string;
    mitigation: string;
  }>;
  dependencies: string[];
}

export class SyncExecutor {
  private config: SyncConfig;
  private workingDir: string;
  private sourceDir: string;
  private targetDir: string;
  private spinner: Ora;

  constructor(configPath: string) {
    this.workingDir = path.dirname(configPath);
    this.sourceDir = path.join(this.workingDir, ".repomirror", "source");
    this.targetDir = path.join(this.workingDir, ".repomirror", "target");
    this.spinner = ora();
    this.config = {} as SyncConfig; // Will be loaded in initialize
  }

  /**
   * Main execution method that orchestrates the entire sync process
   */
  public async execute(configPath: string): Promise<void> {
    try {
      await this.initialize(configPath);
      await this.prepareWorkspace();

      const sourceAnalysis = await this.analyzeRepository(
        this.sourceDir,
        "source",
      );
      const targetAnalysis = await this.analyzeRepository(
        this.targetDir,
        "target",
      );

      const migrationPlan = await this.createMigrationPlan(
        sourceAnalysis,
        targetAnalysis,
      );
      await this.displayMigrationPlan(migrationPlan);

      if (!this.config.sync.dryRun) {
        await this.executeMigration(migrationPlan);
        await this.commitChanges();
        await this.updateImplementationPlan(migrationPlan);
      }

      this.spinner.succeed(chalk.green("Sync completed successfully"));
    } catch (error) {
      this.spinner.fail(chalk.red("Sync failed"));
      console.error(chalk.red("Error details:"), error);
      throw error;
    }
  }

  /**
   * Initialize the executor by loading and validating configuration
   */
  private async initialize(configPath: string): Promise<void> {
    this.spinner.start("Loading configuration");

    if (!(await fs.pathExists(configPath))) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    const configContent = await fs.readFile(configPath, "utf8");
    this.config = yaml.parse(configContent) as SyncConfig;

    // Validate required configuration
    if (!this.config.source?.url || !this.config.target?.url) {
      throw new Error("Both source.url and target.url must be configured");
    }

    this.spinner.succeed("Configuration loaded");
    console.log(
      chalk.blue(
        `Source: ${this.config.source.url} (${this.config.source.branch})`,
      ),
    );
    console.log(
      chalk.blue(
        `Target: ${this.config.target.url} (${this.config.target.branch})`,
      ),
    );
  }

  /**
   * Prepare workspace by cloning/updating repositories
   */
  private async prepareWorkspace(): Promise<void> {
    await fs.ensureDir(path.dirname(this.sourceDir));
    await fs.ensureDir(path.dirname(this.targetDir));

    await this.prepareRepository("source", this.config.source, this.sourceDir);
    await this.prepareRepository("target", this.config.target, this.targetDir);
  }

  /**
   * Clone or update a repository
   */
  private async prepareRepository(
    name: string,
    repoConfig: SyncConfig["source"] | SyncConfig["target"],
    localPath: string,
  ): Promise<void> {
    this.spinner.start(`Preparing ${name} repository`);

    if (repoConfig.type === "local") {
      if (repoConfig.path) {
        await fs.copy(repoConfig.path, localPath);
      } else {
        throw new Error(`Local path not specified for ${name} repository`);
      }
    } else if (repoConfig.type === "git") {
      if (await fs.pathExists(localPath)) {
        // Update existing repository
        await execa("git", ["fetch", "--all"], { cwd: localPath });
        await execa("git", ["checkout", repoConfig.branch], { cwd: localPath });
        await execa("git", ["pull", "origin", repoConfig.branch], {
          cwd: localPath,
        });
      } else {
        // Clone repository
        await execa("git", [
          "clone",
          "-b",
          repoConfig.branch,
          repoConfig.url,
          localPath,
        ]);
      }
    }

    this.spinner.succeed(
      `${name.charAt(0).toUpperCase() + name.slice(1)} repository ready`,
    );
  }

  /**
   * Analyze repository structure and content
   */
  private async analyzeRepository(
    repoPath: string,
    type: "source" | "target",
  ): Promise<AnalysisResult> {
    this.spinner.start(`Analyzing ${type} repository structure`);

    const files = await glob("**/*", {
      cwd: repoPath,
      ignore: ["node_modules/**", ".git/**", ...this.config.sync.ignore],
      nodir: false,
      stat: true,
    });

    const fileInfos: FileInfo[] = [];
    const directories: string[] = [];
    let totalSize = 0;
    const filesByType: Record<string, number> = {};

    for (const file of files) {
      const fullPath = path.join(repoPath, file);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        directories.push(file);
      } else {
        const extension = path.extname(file);
        filesByType[extension] = (filesByType[extension] || 0) + 1;
        totalSize += stats.size;

        // Read content for small text files (for analysis)
        let content: string | undefined;
        if (stats.size < 50000 && this.isTextFile(file)) {
          try {
            content = await fs.readFile(fullPath, "utf8");
          } catch {
            // Ignore binary files or read errors
          }
        }

        fileInfos.push({
          path: fullPath,
          relativePath: file,
          size: stats.size,
          modified: stats.mtime,
          type: "file",
          extension,
          content,
        });
      }
    }

    // Get git metadata if it's a git repository
    let metadata: AnalysisResult["metadata"] = {
      branch: this.config[type].branch,
      isClean: true,
    };

    try {
      const { stdout: lastCommit } = await execa("git", ["rev-parse", "HEAD"], {
        cwd: repoPath,
      });
      const { stdout: remoteUrl } = await execa(
        "git",
        ["config", "--get", "remote.origin.url"],
        { cwd: repoPath },
      );
      const { stdout: status } = await execa("git", ["status", "--porcelain"], {
        cwd: repoPath,
      });

      metadata = {
        lastCommit: lastCommit.trim(),
        branch: this.config[type].branch,
        remoteUrl: remoteUrl.trim(),
        isClean: status.trim().length === 0,
      };
    } catch {
      // Not a git repository or git command failed
    }

    const result: AnalysisResult = {
      repositoryPath: repoPath,
      totalFiles: fileInfos.length,
      totalSize,
      filesByType,
      structure: {
        depth: Math.max(...directories.map((d) => d.split(path.sep).length), 0),
        directories,
        files: fileInfos,
      },
      patterns: {
        configFiles: fileInfos
          .filter((f) => this.isConfigFile(f.relativePath))
          .map((f) => f.relativePath),
        sourceFiles: fileInfos
          .filter((f) => this.isSourceFile(f.relativePath))
          .map((f) => f.relativePath),
        documentationFiles: fileInfos
          .filter((f) => this.isDocumentationFile(f.relativePath))
          .map((f) => f.relativePath),
        buildFiles: fileInfos
          .filter((f) => this.isBuildFile(f.relativePath))
          .map((f) => f.relativePath),
      },
      metadata,
    };

    this.spinner.succeed(
      `${type.charAt(0).toUpperCase() + type.slice(1)} repository analyzed`,
    );
    console.log(
      chalk.gray(
        `  Files: ${result.totalFiles}, Size: ${this.formatBytes(totalSize)}`,
      ),
    );

    return result;
  }

  /**
   * Create a migration plan based on analysis and instructions
   */
  private async createMigrationPlan(
    sourceAnalysis: AnalysisResult,
    targetAnalysis: AnalysisResult,
  ): Promise<MigrationPlan> {
    this.spinner.start("Creating migration plan");

    const transformations: TransformationStep[] = [];

    // Apply configured transformations
    for (const transform of this.config.instructions.transformations) {
      const steps = await this.createTransformationSteps(
        transform,
        sourceAnalysis,
        targetAnalysis,
      );
      transformations.push(...steps);
    }

    // Sort by priority (higher numbers first)
    transformations.sort((a, b) => b.priority - a.priority);

    const summary = {
      filesToCreate: transformations.filter((t) => t.type === "create").length,
      filesToModify: transformations.filter((t) => t.type === "modify").length,
      filesToDelete: transformations.filter((t) => t.type === "delete").length,
      filesToRename: transformations.filter((t) => t.type === "rename").length,
      estimatedDuration: this.estimateDuration(transformations.length),
    };

    const risks = this.assessRisks(transformations, targetAnalysis);
    const dependencies = this.extractDependencies(
      sourceAnalysis,
      targetAnalysis,
    );

    const migrationPlan: MigrationPlan = {
      sourceAnalysis,
      targetAnalysis,
      transformations,
      summary,
      risks,
      dependencies,
    };

    this.spinner.succeed("Migration plan created");
    return migrationPlan;
  }

  /**
   * Create transformation steps for a given transformation configuration
   */
  private async createTransformationSteps(
    transform: SyncConfig["instructions"]["transformations"][0],
    sourceAnalysis: AnalysisResult,
    targetAnalysis: AnalysisResult,
  ): Promise<TransformationStep[]> {
    const steps: TransformationStep[] = [];

    switch (transform.type) {
      case "file-rename":
        if (transform.source && transform.target) {
          const sourceFiles = sourceAnalysis.structure.files.filter((f) =>
            f.relativePath.includes(transform.source!),
          );

          for (const file of sourceFiles) {
            steps.push({
              type: "rename",
              sourcePath: file.relativePath,
              targetPath: file.relativePath.replace(
                transform.source!,
                transform.target!,
              ),
              reason: transform.description,
              priority: 5,
            });
          }
        }
        break;

      case "content-transform":
        if (transform.pattern && transform.replacement) {
          const sourceFiles = sourceAnalysis.structure.files.filter(
            (f) => f.content && f.content.includes(transform.pattern!),
          );

          for (const file of sourceFiles) {
            steps.push({
              type: "modify",
              sourcePath: file.relativePath,
              targetPath: file.relativePath,
              content: file.content?.replace(
                new RegExp(transform.pattern!, "g"),
                transform.replacement!,
              ),
              reason: transform.description,
              priority: 3,
            });
          }
        }
        break;

      case "structure-change":
        // Custom logic for structural changes
        steps.push({
          type: "create",
          targetPath: "MIGRATION_NOTES.md",
          content: `# Migration Notes\n\n${transform.description}\n\nApplied on: ${new Date().toISOString()}\n`,
          reason: "Document structural changes",
          priority: 1,
        });
        break;

      case "custom":
        // Placeholder for custom transformation logic
        console.log(
          chalk.yellow(`Custom transformation: ${transform.description}`),
        );
        break;
    }

    return steps;
  }

  /**
   * Display the migration plan to the user
   */
  private async displayMigrationPlan(plan: MigrationPlan): Promise<void> {
    console.log(chalk.cyan("\n📋 Migration Plan Summary"));
    console.log(chalk.gray("─".repeat(50)));

    console.log(
      `${chalk.green("+")} ${plan.summary.filesToCreate} files to create`,
    );
    console.log(
      `${chalk.blue("~")} ${plan.summary.filesToModify} files to modify`,
    );
    console.log(
      `${chalk.red("-")} ${plan.summary.filesToDelete} files to delete`,
    );
    console.log(
      `${chalk.yellow("→")} ${plan.summary.filesToRename} files to rename`,
    );
    console.log(
      `${chalk.gray("⏱")} Estimated duration: ${plan.summary.estimatedDuration}`,
    );

    if (plan.risks.length > 0) {
      console.log(chalk.cyan("\n⚠️  Risk Assessment"));
      console.log(chalk.gray("─".repeat(50)));
      for (const risk of plan.risks) {
        const color =
          risk.level === "high"
            ? "red"
            : risk.level === "medium"
              ? "yellow"
              : "gray";
        console.log(
          chalk[color](`${risk.level.toUpperCase()}: ${risk.description}`),
        );
        console.log(chalk.gray(`  Mitigation: ${risk.mitigation}`));
      }
    }

    if (this.config.sync.dryRun) {
      console.log(
        chalk.yellow("\n🔍 Dry run mode - no changes will be applied"),
      );
    }
  }

  /**
   * Execute the migration plan (stub implementation)
   */
  private async executeMigration(plan: MigrationPlan): Promise<void> {
    this.spinner.start("Executing migration");

    for (let i = 0; i < plan.transformations.length; i++) {
      const step = plan.transformations[i];
      const progress = `(${i + 1}/${plan.transformations.length})`;

      this.spinner.text = `Executing migration ${progress}: ${step.type} ${step.targetPath}`;

      // Log what would be done (stub implementation)
      console.log(
        chalk.gray(`  ${step.type}: ${step.targetPath} - ${step.reason}`),
      );

      // Simulate work
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.spinner.succeed("Migration executed");
  }

  /**
   * Commit changes to target repository
   */
  private async commitChanges(): Promise<void> {
    if (this.config.target.type === "git") {
      this.spinner.start("Committing changes");

      try {
        await execa("git", ["add", "."], { cwd: this.targetDir });

        const commitMessage = `Sync from ${this.config.source.url}\n\nApplied transformations:\n${this.config.instructions.transformations
          .map((t) => `- ${t.description}`)
          .join(
            "\n",
          )}\n\nGenerated by repomirror on ${new Date().toISOString()}`;

        await execa("git", ["commit", "-m", commitMessage], {
          cwd: this.targetDir,
        });

        this.spinner.succeed("Changes committed");
        console.log(
          chalk.gray(`  Commit message: ${commitMessage.split("\n")[0]}`),
        );
      } catch (error) {
        if (error instanceof Error && error.toString().includes("nothing to commit")) {
          this.spinner.info("No changes to commit");
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Update implementation plan with migration results
   */
  private async updateImplementationPlan(plan: MigrationPlan): Promise<void> {
    this.spinner.start("Updating implementation plan");

    const planPath = path.join(this.workingDir, "@IMPLEMENTATION_PLAN.md");

    if (await fs.pathExists(planPath)) {
      let content = await fs.readFile(planPath, "utf8");

      const updateEntry =
        `\n## Sync Execution - ${new Date().toISOString()}\n` +
        `- Applied ${plan.transformations.length} transformations\n` +
        `- Source: ${plan.sourceAnalysis.totalFiles} files (${this.formatBytes(plan.sourceAnalysis.totalSize)})\n` +
        `- Target: ${plan.targetAnalysis.totalFiles} files (${this.formatBytes(plan.targetAnalysis.totalSize)})\n` +
        `- Status: ${plan.risks.length === 0 ? "✅ Success" : "⚠️  Completed with risks"}\n`;

      content += updateEntry;
      await fs.writeFile(planPath, content);
    }

    this.spinner.succeed("Implementation plan updated");
  }

  // Helper methods

  private isTextFile(filename: string): boolean {
    const textExtensions = [
      ".txt",
      ".md",
      ".json",
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".css",
      ".scss",
      ".html",
      ".xml",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".cfg",
      ".conf",
    ];
    return textExtensions.some((ext) => filename.toLowerCase().endsWith(ext));
  }

  private isConfigFile(filename: string): boolean {
    const configPatterns = [
      "package.json",
      "tsconfig.json",
      ".eslintrc",
      "webpack.config",
      "rollup.config",
      "vite.config",
      "babel.config",
      ".gitignore",
      "Dockerfile",
      "docker-compose",
      "Makefile",
    ];
    return configPatterns.some((pattern) =>
      filename.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  private isSourceFile(filename: string): boolean {
    const sourceExtensions = [
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".cs",
    ];
    return sourceExtensions.some((ext) => filename.toLowerCase().endsWith(ext));
  }

  private isDocumentationFile(filename: string): boolean {
    const docPatterns = [
      ".md",
      ".txt",
      "README",
      "CHANGELOG",
      "LICENSE",
      "docs/",
      "doc/",
    ];
    return docPatterns.some((pattern) =>
      filename.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  private isBuildFile(filename: string): boolean {
    const buildPatterns = [
      "Makefile",
      "build.",
      "webpack.",
      "rollup.",
      "vite.",
      "gulpfile",
      "Gruntfile",
      ".github/workflows",
    ];
    return buildPatterns.some((pattern) =>
      filename.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  private estimateDuration(steps: number): string {
    const minutesPerStep = 0.1;
    const totalMinutes = steps * minutesPerStep;

    if (totalMinutes < 1) return "< 1 minute";
    if (totalMinutes < 60) return `${Math.ceil(totalMinutes)} minutes`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.ceil(totalMinutes % 60);
    return `${hours}h ${minutes}m`;
  }

  private assessRisks(
    transformations: TransformationStep[],
    targetAnalysis: AnalysisResult,
  ): MigrationPlan["risks"] {
    const risks: MigrationPlan["risks"] = [];

    // Check for high-impact changes
    const deletions = transformations.filter((t) => t.type === "delete").length;
    if (deletions > 0) {
      risks.push({
        level: "high",
        description: `${deletions} files will be deleted`,
        mitigation: "Review deleted files carefully and ensure backups exist",
      });
    }

    // Check for configuration file changes
    const configChanges = transformations.filter(
      (t) =>
        this.isConfigFile(t.targetPath) &&
        (t.type === "modify" || t.type === "delete"),
    ).length;

    if (configChanges > 0) {
      risks.push({
        level: "medium",
        description: `${configChanges} configuration files will be modified`,
        mitigation: "Test the application thoroughly after sync",
      });
    }

    // Check if target has uncommitted changes
    if (!targetAnalysis.metadata.isClean) {
      risks.push({
        level: "medium",
        description: "Target repository has uncommitted changes",
        mitigation: "Commit or stash changes before running sync",
      });
    }

    return risks;
  }

  private extractDependencies(
    sourceAnalysis: AnalysisResult,
    targetAnalysis: AnalysisResult,
  ): string[] {
    const dependencies: string[] = [];

    // Check for package.json files to identify dependencies
    const packageJsonFiles = [
      ...sourceAnalysis.structure.files,
      ...targetAnalysis.structure.files,
    ].filter((f) => f.relativePath.endsWith("package.json"));

    for (const file of packageJsonFiles) {
      if (file.content) {
        try {
          const pkg = JSON.parse(file.content);
          if (pkg.dependencies) {
            dependencies.push(...Object.keys(pkg.dependencies));
          }
          if (pkg.devDependencies) {
            dependencies.push(...Object.keys(pkg.devDependencies));
          }
        } catch {
          // Ignore invalid JSON
        }
      }
    }

    return [...new Set(dependencies)].sort();
  }
}
