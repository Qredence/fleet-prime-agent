# @qredence/fleet

Fleet Prime Agent is Qredence's persistent local workspace for coding and
research with AI: a multi-project web chat built on the upstream
[Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) engine. The
engine is installed as a checksum-pinned dependency and never modified; Fleet
adds the web interface, workspace navigation, streaming tool cards, and
managed IPython kernels.

## Install

Requires Node.js 22.12.0 or later. Python 3.10 or later is needed for the
managed IPython kernel.

```bash
npm install -g @qredence/fleet
```

## Use

Run the launcher from the project directory you want the agent to work in:

```bash
cd /path/to/your/project
fleet-agent
```

Open the local URL the launcher prints. On first use, add a provider in
**Settings → Providers** (or run `/login`) and choose a model in the composer.
`fleet-prime` is an alias for the same launcher, and `fleet-agent agent`
exposes the upstream Prime Agent CLI.

## Learn more

- [Fleet Prime Agent repository](https://github.com/Qredence/fleet-prime-agent)
- [Prime Agent engine documentation](https://github.com/PrimeIntellect-ai/prime-agent#readme)

## License

MIT — see [LICENSE](LICENSE). The upstream Prime Agent engine keeps its own
license; this package consumes it as a pinned dependency.
