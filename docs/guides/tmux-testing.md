# Manual tmux testing

Use tmux when the Fleet terminal mode or its interactive Prime Agent TUI lifecycle must be tested manually. Keep the session name unique to the test and do not kill sessions you did not create.

## Basic flow

~~~bash
bash
readonly session_name="fleet-agent-test-$(date +%s)-$$-$RANDOM"
tmux new-session -d -s "$session_name" -x 80 -y 24 || exit 1
trap 'tmux kill-session -t "$session_name" 2>/dev/null || true' EXIT
tmux send-keys -t "$session_name" 'fleet-agent agent' Enter
tmux capture-pane -t "$session_name" -p
~~~

Run the remaining commands in that same dedicated Bash shell so the cleanup trap applies to the session it created.

Send only the input needed for the scenario, then capture the pane again:

~~~bash
tmux send-keys -t "$session_name" 'your test input' Enter
tmux capture-pane -t "$session_name" -p
~~~

Exercise cancellation, mode changes, or other key paths with the same configurable controls used by the product. Clean up only the named session:

~~~bash
exit
~~~

For automated adapter behavior, prefer deterministic server test doubles and focused Vitest suites. Manual tmux testing does not replace those checks.
