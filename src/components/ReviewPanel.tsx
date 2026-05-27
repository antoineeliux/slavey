import { useState } from "react";
import { Check, GitBranch, ListTree, X } from "lucide-react";

import { useAppStore } from "../store/appStore";
import { reviewFileKey } from "../store/helpers";
import type {
  RepoHealth,
  WorktreeCommit,
  WorktreeHandoffApplyResult,
  WorktreeHandoffPreflight,
  WorktreeReview,
} from "../types";
import {
  formatStrategy,
  handoffApplyDisabledReason,
} from "./panelUtils";

export function ReviewPanel({
  employeeId,
  review,
  changedFiles,
  selectedFile,
  fileDiffs,
  commits,
  handoff,
  handoffResult,
  repoHealth,
  onRefresh,
}: {
  employeeId: string;
  review?: WorktreeReview;
  changedFiles: string[];
  selectedFile: string | null;
  fileDiffs: Record<string, string>;
  commits: WorktreeCommit[];
  handoff?: WorktreeHandoffPreflight;
  handoffResult?: WorktreeHandoffApplyResult;
  repoHealth: RepoHealth | null;
  onRefresh: () => void;
}) {
  const settings = useAppStore((state) => state.settings);
  const [commitMessage, setCommitMessage] = useState("");
  const selectReviewFile = useAppStore((state) => state.selectReviewFile);
  const stageWorktreeFile = useAppStore((state) => state.stageWorktreeFile);
  const unstageWorktreeFile = useAppStore((state) => state.unstageWorktreeFile);
  const discardWorktreeFile = useAppStore((state) => state.discardWorktreeFile);
  const deleteUntrackedWorktreeFile = useAppStore(
    (state) => state.deleteUntrackedWorktreeFile,
  );
  const commitWorktree = useAppStore((state) => state.commitWorktree);
  const applyWorktreeHandoff = useAppStore((state) => state.applyWorktreeHandoff);
  const abortWorktreeHandoff = useAppStore((state) => state.abortWorktreeHandoff);
  const selectedReviewFile = selectedFile
    ? review?.files.find((file) => file.path === selectedFile) ?? null
    : null;
  const fileDiff = selectedFile ? fileDiffs[reviewFileKey(employeeId, selectedFile)] ?? "" : "";
  const stageDisabledReason = reviewFileActionDisabledReason(
    selectedFile,
    selectedReviewFile,
    "stage",
  );
  const unstageDisabledReason = reviewFileActionDisabledReason(
    selectedFile,
    selectedReviewFile,
    "unstage",
  );
  const discardDisabledReason = reviewFileActionDisabledReason(
    selectedFile,
    selectedReviewFile,
    "discard",
  );
  const deleteDisabledReason = reviewFileActionDisabledReason(
    selectedFile,
    selectedReviewFile,
    "delete",
  );
  const canStage = !stageDisabledReason;
  const canUnstage = !unstageDisabledReason;
  const canDiscard = !discardDisabledReason;
  const canDeleteUntracked = !deleteDisabledReason;
  const commitDisabledReason = review?.disabledReasons.commit ?? null;
  const canCommit = !commitDisabledReason && commitMessage.trim().length > 0;
  const reviewHandoff = review?.handoff ?? handoff;
  const latestCommit = (review?.recentCommits ?? commits)[0] ?? null;
  const commitsToApply = reviewHandoff?.commitsToApply ?? [];
  const handoffDisabledReason =
    review?.disabledReasons.handoffApply ?? handoffApplyDisabledReason(repoHealth, reviewHandoff);
  const canApplyHandoff = reviewHandoff?.canApply === true && !handoffDisabledReason;
  const canAbortHandoff = reviewHandoff?.mainOperation.canAbort === true;
  const groupedFiles = reviewFileGroups(review, changedFiles);
  const hasReviewConflicts = Boolean(
    review?.conflictedFiles.length || reviewHandoff?.mainConflictedFiles.length,
  );

  const runCommit = async () => {
    const message = commitMessage.trim();
    if (!message) {
      return;
    }
    await commitWorktree(employeeId, message);
    setCommitMessage("");
  };

  const runApplyHandoff = () => {
    if (!reviewHandoff?.canApply || handoffDisabledReason) {
      return;
    }
    const targetBranch = reviewHandoff.mainBranch ?? "main workspace";
    const confirmed =
      !settings.requireConfirmationHandoffApply ||
      window.confirm(
        `Apply ${commitsToApply.length} commit(s) to ${targetBranch} with cherry-pick?\n\nThis will not push or remove the employee worktree.`,
      );
    if (confirmed) {
      void applyWorktreeHandoff(employeeId);
    }
  };

  const runAbortHandoff = () => {
    const confirmed = window.confirm("Abort the in-progress cherry-pick in the main workspace?");
    if (confirmed) {
      void abortWorktreeHandoff(employeeId);
    }
  };

  return (
    <section className="review-panel">
      <div className="section-heading">
        <GitBranch size={15} />
        Review
        <button className="icon-button" title="Refresh review" onClick={onRefresh}>
          <ListTree size={14} />
        </button>
      </div>
      <div className="policy-grid">
        <span>Branch</span>
        <strong title={review?.branchName ?? ""}>{review?.branchName ?? "unknown"}</strong>
        <span>Base</span>
        <strong title={review?.baseBranch ?? ""}>{review?.baseBranch ?? "unknown"}</strong>
        <span>Base delta</span>
        <strong>{formatAheadBehind(review?.ahead, review?.behind)}</strong>
        <span>Upstream</span>
        <strong title={review?.upstreamBranch ?? ""}>{review?.upstreamBranch ?? "none"}</strong>
        <span>Upstream delta</span>
        <strong>{formatAheadBehind(review?.upstreamAhead, review?.upstreamBehind)}</strong>
        <span>Remote</span>
        <strong title={review?.remote.remoteUrl ?? ""}>{review?.remote.remoteName ?? "none"}</strong>
        <span>State</span>
        <strong>{review ? (review.clean ? "clean" : "dirty") : "unknown"}</strong>
        <span>Operation</span>
        <strong>{review?.operation.message ?? "ready"}</strong>
        <span>Push</span>
        <strong>{review?.disabledReasons.push ?? "read-only"}</strong>
      </div>
      {review?.blockers.length ? (
        <div className="handoff-blockers">
          {review.blockers.map((blocker) => (
            <div className="inline-warning" key={blocker}>
              {blocker}
            </div>
          ))}
        </div>
      ) : null}
      {hasReviewConflicts ? (
        <div className="handoff-result warning">
          <strong>Conflict recovery</strong>
          {review?.conflictedFiles.length ? (
            <span>Worktree conflicts: {review.conflictedFiles.join(", ")}</span>
          ) : null}
          {reviewHandoff?.mainConflictedFiles.length ? (
            <span>Main workspace conflicts: {reviewHandoff.mainConflictedFiles.join(", ")}</span>
          ) : null}
          <span>
            {reviewHandoff?.mainOperation.canAbort
              ? "Abort is available below."
              : "Resolve conflicts manually."}
          </span>
        </div>
      ) : null}
      <div className="review-file-grid">
        <div className="review-file-list">
          {groupedFiles.every((group) => group.files.length === 0) ? (
            <div className="empty-panel">No changed files.</div>
          ) : (
            groupedFiles.map((group) =>
              group.files.length ? (
                <div className="review-file-group" key={group.title}>
                  <span className="review-file-group-title">{group.title}</span>
                  {group.files.map((file) => (
                    <button
                      className={file.path === selectedFile ? "review-file active" : "review-file"}
                      key={`${group.title}-${file.path}`}
                      title={file.path}
                      onClick={() => selectReviewFile(employeeId, file.path)}
                    >
                      <span>{file.path}</span>
                      <strong>{file.label}</strong>
                    </button>
                  ))}
                </div>
              ) : null,
            )
          )}
        </div>
        <div className="review-file-detail">
          <div className="approval-actions">
            <button
              className="command-button compact"
              disabled={!canStage}
              title={stageDisabledReason ?? "Stage file"}
              onClick={() => selectedFile && void stageWorktreeFile(employeeId, selectedFile)}
            >
              Stage
            </button>
            <button
              className="command-button compact"
              disabled={!canUnstage}
              title={unstageDisabledReason ?? "Unstage file"}
              onClick={() => selectedFile && void unstageWorktreeFile(employeeId, selectedFile)}
            >
              Unstage
            </button>
            <button
              className="command-button compact"
              disabled={!canDiscard}
              title={discardDisabledReason ?? "Discard unstaged changes"}
              onClick={() => {
                if (
                  selectedFile &&
                  (!settings.requireConfirmationDiscard ||
                    window.confirm(`Discard unstaged changes in ${selectedFile}?`))
                ) {
                  void discardWorktreeFile(employeeId, selectedFile);
                }
              }}
            >
              Discard
            </button>
            <button
              className="command-button compact danger"
              disabled={!canDeleteUntracked}
              title={deleteDisabledReason ?? "Delete untracked file"}
              onClick={() => {
                if (
                  selectedFile &&
                  (!settings.requireConfirmationDelete ||
                    window.confirm(`Delete untracked file ${selectedFile}?`))
                ) {
                  void deleteUntrackedWorktreeFile(employeeId, selectedFile);
                }
              }}
            >
              Delete
            </button>
          </div>
          <ReviewBlock
            title={selectedFile ?? "Selected file"}
            value={fileDiff}
            empty={selectedFile ? "No file diff." : "Select a changed file."}
          />
        </div>
      </div>
      <ReviewBlock title="Status" value={review?.status.join("\n") ?? ""} empty="No status changes." />
      <ReviewBlock
        title="Untracked"
        value={review?.untrackedFiles.join("\n") ?? ""}
        empty="No untracked files."
      />
      <div className="commit-panel">
        <input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit message"
          aria-label="Commit message"
        />
        <button
          className="command-button primary compact"
          disabled={!canCommit}
          title={commitDisabledReason ?? "Commit staged files"}
          onClick={() => void runCommit()}
        >
          Commit
        </button>
      </div>
      <CommitList commits={review?.recentCommits ?? commits} empty="No recent commits." />
      <div className="handoff-panel">
        <div className="section-heading compact-heading">
          <GitBranch size={15} />
          Handoff
        </div>
        <div className={canApplyHandoff ? "handoff-state ready" : "handoff-state blocked"}>
          {canApplyHandoff ? "Ready to apply" : "Blocked"}
        </div>
        <div className="policy-grid">
          <span>Branch</span>
          <strong title={reviewHandoff?.employeeBranch ?? review?.branchName ?? ""}>
            {reviewHandoff?.employeeBranch ?? review?.branchName ?? "unknown"}
          </strong>
          <span>Main</span>
          <strong title={reviewHandoff?.mainBranch ?? ""}>
            {reviewHandoff?.mainBranch ?? "unknown"}
          </strong>
          <span>Strategy</span>
          <strong>{reviewHandoff ? formatStrategy(reviewHandoff.applyStrategy) : "unknown"}</strong>
          <span>Ahead</span>
          <strong>{reviewHandoff?.ahead ?? "unknown"}</strong>
          <span>Behind</span>
          <strong>{reviewHandoff?.behind ?? "unknown"}</strong>
          <span>Employee</span>
          <strong>{reviewHandoff ? (reviewHandoff.employeeClean ? "clean" : "dirty") : "unknown"}</strong>
          <span>Main clean</span>
          <strong>{reviewHandoff ? (reviewHandoff.mainClean ? "clean" : "dirty") : "unknown"}</strong>
          <span>State</span>
          <strong>{reviewHandoff?.mainOperation.message ?? "ready"}</strong>
          <span>Latest</span>
          <strong title={latestCommit?.message ?? ""}>
            {latestCommit ? `${latestCommit.shortHash} ${latestCommit.message}` : "none"}
          </strong>
          <span>Apply</span>
          <strong>{reviewHandoff?.message ?? "preflight pending"}</strong>
        </div>
        <CommitList commits={commitsToApply} empty="No commits to apply." />
        {reviewHandoff?.blockers.length ? (
          <div className="handoff-blockers">
            {reviewHandoff.blockers.map((blocker) => (
              <div className="inline-warning" key={blocker}>
                {blocker}
              </div>
            ))}
          </div>
        ) : null}
        {handoffDisabledReason ? <div className="inline-warning">{handoffDisabledReason}</div> : null}
        {handoffResult ? (
          <div className={handoffResult.applied ? "handoff-result" : "handoff-result warning"}>
            <strong>
              {handoffResult.applied
                ? `Applied ${handoffResult.appliedCommits.length} commit(s)`
                : handoffResult.conflict
                  ? "Stopped with conflicts"
                  : "Apply failed"}
            </strong>
            {handoffResult.error ? <span title={handoffResult.error}>{handoffResult.error}</span> : null}
          </div>
        ) : null}
        <div className="approval-actions">
          <button
            className="command-button primary compact"
            disabled={!canApplyHandoff}
            onClick={runApplyHandoff}
            title={handoffDisabledReason || reviewHandoff?.blockers.join("; ") || "Apply handoff"}
          >
            <Check size={14} />
            Apply
          </button>
          {canAbortHandoff ? (
            <button className="command-button compact danger" onClick={runAbortHandoff}>
              <X size={14} />
              Abort
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ReviewBlock({ title, value, empty }: { title: string; value: string; empty: string }) {
  return (
    <div className="review-block">
      <strong>{title}</strong>
      <pre>{value.trim() || empty}</pre>
    </div>
  );
}

function CommitList({ commits, empty }: { commits: WorktreeCommit[]; empty: string }) {
  return (
    <div className="handoff-commits">
      {commits.length === 0 ? (
        <div className="empty-panel">{empty}</div>
      ) : (
        commits.map((commit) => (
          <div className="handoff-commit" key={commit.hash}>
            <code>{commit.shortHash}</code>
            <span title={commit.message}>{commit.message}</span>
          </div>
        ))
      )}
    </div>
  );
}

type ReviewFileListItem = { path: string; label: string };

function reviewFileGroups(
  review: WorktreeReview | undefined,
  fallbackChangedFiles: string[],
): Array<{ title: string; files: ReviewFileListItem[] }> {
  if (!review) {
    return [
      {
        title: "Changed",
        files: fallbackChangedFiles.map((path) => ({ path, label: "changed" })),
      },
    ];
  }

  const fileByPath = new Map(review.files.map((file) => [file.path, file]));
  const toItems = (paths: string[], fallbackLabel: string) =>
    paths.map((path) => {
      const file = fileByPath.get(path);
      return {
        path,
        label: file ? reviewFileLabel(file) : fallbackLabel,
      };
    });

  return [
    { title: "Conflicted", files: toItems(review.conflictedFiles, "conflicted") },
    { title: "Staged", files: toItems(review.stagedFiles, "staged") },
    { title: "Unstaged", files: toItems(review.unstagedFiles, "unstaged") },
    { title: "Untracked", files: toItems(review.untrackedFiles, "untracked") },
  ];
}

function reviewFileLabel(file: WorktreeReview["files"][number]): string {
  if (file.conflicted) {
    return "conflicted";
  }
  if (file.untracked) {
    return "untracked";
  }
  if (file.staged && file.unstaged) {
    return "staged + unstaged";
  }
  if (file.staged) {
    return file.renamed ? "renamed" : file.deleted ? "deleted" : "staged";
  }
  if (file.unstaged) {
    return file.deleted ? "deleted" : "unstaged";
  }
  return "changed";
}

function reviewFileActionDisabledReason(
  selectedFile: string | null,
  file: WorktreeReview["files"][number] | null,
  action: "stage" | "unstage" | "discard" | "delete",
): string | null {
  if (!selectedFile) {
    return "Select a changed file";
  }
  if (!file) {
    return "Selected file is not in the current review";
  }
  if (file.conflicted && action !== "delete") {
    return "Resolve conflicts before changing file staging";
  }
  if (action === "unstage" && !file.staged) {
    return "Select a staged file";
  }
  if (action === "discard" && !file.unstaged) {
    return "Select an unstaged file";
  }
  if (action === "delete" && !file.untracked) {
    return "Select an untracked file";
  }
  return null;
}

function formatAheadBehind(ahead?: number | null, behind?: number | null): string {
  if (ahead == null && behind == null) {
    return "unknown";
  }
  return `+${ahead ?? 0} / -${behind ?? 0}`;
}
