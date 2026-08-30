# Testing Prime Agent Interactive Mode with tmux

Read this before driving the Prime Agent TUI in a terminal.

To test Prime Agent's TUI in a controlled terminal environment:

```bash
# Create tmux session with specific dimensions
tmux new-session -d -s prime-agent-test -x 80 -y 24

# Start the stock upstream Prime Agent CLI
tmux send-keys -t prime-agent-test "prime-agent" Enter

# Wait for startup, then capture output
sleep 3 && tmux capture-pane -t prime-agent-test -p

# Send input
tmux send-keys -t prime-agent-test "your prompt here" Enter

# Send special keys
tmux send-keys -t prime-agent-test Escape
tmux send-keys -t prime-agent-test C-o  # ctrl+o

# Cleanup
tmux kill-session -t prime-agent-test
```

You, yourself, are often running into a tmux session, so be careful when
killing tmux sessions. Lots of other processes can be running on different
tmux sessions.
