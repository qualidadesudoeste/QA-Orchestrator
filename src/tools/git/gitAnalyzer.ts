import simpleGit, { type SimpleGit } from 'simple-git'
import { Octokit } from '@octokit/rest'
import { env } from '@config/environments'
import { logger } from '@utils/logger'

interface DiffSummary {
  changedFiles: string[]
  additions: number
  deletions: number
  affectedModules: string[]
}

export class GitAnalyzer {
  private git: SimpleGit
  private octokit?: Octokit

  constructor(repoPath = process.cwd()) {
    this.git = simpleGit(repoPath)
    if (env.GITHUB_TOKEN) {
      this.octokit = new Octokit({ auth: env.GITHUB_TOKEN })
    }
  }

  async analyzeCommit(commitHash: string): Promise<DiffSummary> {
    const diff = await this.git.show(['--stat', commitHash])
    const changedFiles = this.parseChangedFiles(diff)

    logger.info(`Commit ${commitHash} — ${changedFiles.length} arquivo(s) alterado(s)`)

    return {
      changedFiles,
      additions: 0,
      deletions: 0,
      affectedModules: this.inferModules(changedFiles),
    }
  }

  async analyzePR(prNumber: number): Promise<DiffSummary> {
    if (!this.octokit || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
      throw new Error('GitHub não configurado. Defina GITHUB_TOKEN, GITHUB_OWNER e GITHUB_REPO.')
    }

    const { data: files } = await this.octokit.pulls.listFiles({
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      pull_number: prNumber,
    })

    const changedFiles = files.map(f => f.filename)
    const additions = files.reduce((sum, f) => sum + f.additions, 0)
    const deletions = files.reduce((sum, f) => sum + f.deletions, 0)

    logger.info(`PR #${prNumber} — ${changedFiles.length} arquivo(s) | +${additions} -${deletions}`)

    return {
      changedFiles,
      additions,
      deletions,
      affectedModules: this.inferModules(changedFiles),
    }
  }

  async getRecentCommits(count = 10): Promise<string[]> {
    const log = await this.git.log({ maxCount: count })
    return log.all.map(c => `${c.hash.slice(0, 7)} — ${c.message}`)
  }

  private parseChangedFiles(diffOutput: string): string[] {
    return diffOutput
      .split('\n')
      .filter(line => line.includes('|'))
      .map(line => line.trim().split('|')[0].trim())
  }

  private inferModules(files: string[]): string[] {
    const modules = new Set<string>()
    for (const file of files) {
      const parts = file.split('/')
      if (parts.length > 1) modules.add(parts[0])
    }
    return [...modules]
  }
}
