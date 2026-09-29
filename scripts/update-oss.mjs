// Regenerates the "Open source" table in README.md from the GitHub search API.
// Lists public pull requests and issues authored by LOGIN in repositories LOGIN does not own.
// Run: GITHUB_TOKEN=... node scripts/update-oss.mjs

import { readFile, writeFile } from 'node:fs/promises'

const LOGIN = 'AsifMahsud'
const README = new URL('../README.md', import.meta.url)
const START = '<!-- OSS:START -->'
const END = '<!-- OSS:END -->'
const MAX_ROWS = 40
// Course and exercise repositories are not contributions.
const EXCLUDED_OWNERS = new Set(['ibm-developer-skills-network'])

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

async function search(query) {
  const items = []
  for (let page = 1; page <= 10; page++) {
    const url = new URL('https://api.github.com/search/issues')
    url.searchParams.set('q', query)
    url.searchParams.set('sort', 'created')
    url.searchParams.set('order', 'desc')
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `${LOGIN}-profile-updater`,
      },
    })
    if (!res.ok) throw new Error(`GitHub search failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    items.push(...data.items)
    if (items.length >= data.total_count || data.items.length === 0) break
  }
  return items
}

function repoOf(item) {
  return item.repository_url.replace('https://api.github.com/repos/', '')
}

function prState(item) {
  if (item.pull_request?.merged_at) return 'Merged'
  if (item.state === 'closed') return 'Closed'
  return item.draft ? 'Draft' : 'Open'
}

function issueState(item) {
  if (item.state !== 'closed') return 'Open'
  return item.state_reason === 'completed' ? 'Resolved' : 'Closed'
}

function escapeCell(text) {
  return text
    .replace(/^[^\w\[\(]+/u, '') // leading emoji from issue templates
    .replace(/^Bug:\s*/i, '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim()
}

function fmtDate(iso) {
  return iso.slice(0, 10)
}

function table(rows) {
  const header = '| Project | Contribution | Status | Date |\n| --- | --- | --- | --- |\n'
  return header + rows.join('\n') + '\n'
}

const base = `author:${LOGIN} -user:${LOGIN} is:public`
const keep = (item) => !EXCLUDED_OWNERS.has(repoOf(item).split('/')[0])
const [prsAll, issuesAll] = await Promise.all([search(`type:pr ${base}`), search(`type:issue ${base}`)])
// Closed-without-merge pull requests are not listed.
const prs = prsAll.filter(keep).filter((p) => p.state === 'open' || p.pull_request?.merged_at)
const issues = issuesAll.filter(keep)

const prRows = prs.slice(0, MAX_ROWS).map((p) => {
  const repo = repoOf(p)
  return `| [${repo}](https://github.com/${repo}) | [${escapeCell(p.title)}](${p.html_url}) | ${prState(p)} | ${fmtDate(p.created_at)} |`
})
const issueRows = issues.slice(0, MAX_ROWS).map((i) => {
  const repo = repoOf(i)
  return `| [${repo}](https://github.com/${repo}) | [${escapeCell(i.title)}](${i.html_url}) | ${issueState(i)} | ${fmtDate(i.created_at)} |`
})

const merged = prs.filter((p) => p.pull_request?.merged_at).length
const open = prs.filter((p) => p.state === 'open').length
const projects = new Set(prs.map(repoOf).concat(issues.map(repoOf)))

let body = `${START}\n`
body += `_${prs.length} pull requests (${merged} merged, ${open} open) and ${issues.length} issues across ${projects.size} projects. Updated ${fmtDate(new Date().toISOString())}._\n\n`
body += '### Pull requests\n\n'
body += prRows.length ? table(prRows) : '_None yet._\n'
if (prs.length > MAX_ROWS) body += `\n[All pull requests](https://github.com/pulls?q=is%3Apr+author%3A${LOGIN}+-user%3A${LOGIN}+is%3Apublic)\n`
body += '\n### Issues\n\n'
body += issueRows.length ? table(issueRows) : '_None yet._\n'
if (issues.length > MAX_ROWS) body += `\n[All issues](https://github.com/issues?q=is%3Aissue+author%3A${LOGIN}+-user%3A${LOGIN}+is%3Apublic)\n`
body += END

const readme = await readFile(README, 'utf8')
const start = readme.indexOf(START)
const end = readme.indexOf(END)
if (start === -1 || end === -1) {
  console.error(`README.md is missing the ${START} / ${END} markers`)
  process.exit(1)
}
const next = readme.slice(0, start) + body + readme.slice(end + END.length)
if (next === readme) {
  console.log('README.md unchanged')
} else {
  await writeFile(README, next)
  console.log(`README.md updated: ${prs.length} PRs, ${issues.length} issues`)
}
