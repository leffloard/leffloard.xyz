import type { Repo } from "@/lib/content/types";
import { formatPostDate } from "@/lib/content/types";

// Public repositories from GitHub that have no case study of their own.
export function RepoList({ repos }: { repos: Repo[] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {repos.map((repo) => (
        <li key={repo.url} className="reveal">
          <a
            href={repo.url}
            rel="noopener noreferrer"
            className="group flex h-full flex-col gap-3 rounded-2xl border border-line p-6 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="font-mono text-[15px] font-medium group-hover:text-accent">{repo.name}</span>
            {repo.description ? (
              <span className="text-[15px] text-pretty text-muted">{repo.description}</span>
            ) : null}
            <span className="mt-auto flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted">
              {repo.language ? <span>{repo.language}</span> : null}
              <span>
                <span aria-hidden>★ </span>
                {repo.stars} {repo.stars === 1 ? "star" : "stars"}
              </span>
              {repo.pushedAt ? <span>updated {formatPostDate(repo.pushedAt)}</span> : null}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
