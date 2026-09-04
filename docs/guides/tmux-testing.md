# Manual tmux testing

Use tmux when an interactive Prime Agent TUI or terminal lifecycle must be tested manually. Keep the session name unique to the test and do not kill sessions you did not create.

## Basic flow

~~~bash
tmux new-session -d -s prime-agent-test -x 80 -y 24
tmux send-keys -t prime-agent-test 'prime-agent' Enter
tmux capture-pane -t prime-agent-test -p
~~~

Send only the input needed for the scenario, then capture the pane again:

~~~bash
tmux send-keys -t prime-agent-test 'your test input' Enter
tmux capture-pane -t prime-agent-test -p
~~~

Exercise cancellation, mode changes, or other key paths with the same configurable controls used by the product. Clean up only the named session:

~~~bash
tmux kill-session -t prime-agent-test
~~~

For automated adapter behavior, prefer deterministic server test doubles and focused Vitest suites. Manual tmux testing does not replace those checks.
