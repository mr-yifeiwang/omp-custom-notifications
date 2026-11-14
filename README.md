# OMP Custom Notifications

An OMP extension that sends macOS notifications when the agent needs your attention. It sends notifications when:

- A response finishes
- An interactive question is asked
- A tool approval is requested
- A request fails after any automatic retries have ended

## Requirements

- macOS
- [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi)
- [terminal-notifier](https://github.com/julienXX/terminal-notifier), installable via `brew`

## Installation

```sh
omp plugin install git:github.com/mr-yifeiwang/omp-custom-notifications
```
