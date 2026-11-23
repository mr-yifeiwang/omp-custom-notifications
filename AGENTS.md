# AGENTS.md

## Live Development and Testing

When the user requests a live test in the normal OMP environment:

1. Disable installed `omp-custom-notifications` to prevent duplicate notifications.
2. Create a symbolic link of `~/.omp/agent/extensions/omp-custom-notifications/` to this project. Ask the user to reload the session.
3. When live development and testing ends, remove the symlink and restore the installed plugin's original enabled state.
