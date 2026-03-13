# Heartbeat

Review pending work for this agent and decide whether it should be resumed.

## When To Run

Return `run` only when there is a concrete task that should be resumed now.

Examples:
- A follow-up task is waiting on a timer or deadline.
- A queued background task needs progress.
- A user-facing promise requires a proactive update.

## When To Skip

Return `skip` when there is no actionable work right now.

Examples:
- There are no active commitments.
- The next step depends on new user input.
- Nothing has changed since the last check.

## Output

If you return `run`, summarize the actionable tasks clearly and briefly so the
agent can continue work in its normal loop.
