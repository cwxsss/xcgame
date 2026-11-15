# 小褚游戏厅 · xcgame

基于 boardgame.io 的中文在线桌游厅，包含宝石商人和阿瓦隆，支持邀请链接、AI 补位、回合计时及房间语音。

## 本地启动

使用 Node.js 24 和 pnpm，在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm --dir examples/react-web install --frozen-lockfile
pnpm run build
pnpm --dir examples/react-web run tabletop:build
$env:TABLETOP_ACCESS_PASSWORD = '设置一个本地入口密码'
pnpm run tabletop:serve
```

浏览器打开 `http://127.0.0.1:8000`。部署时可配置 `HOST`、`PORT`、`BOARDGAME_ORIGIN` 和 `FLATFILE_DIR`。多人语音需要 HTTPS，持久化门禁会话可配置 `TABLETOP_ACCESS_SECRET`。入口密码和签名密钥应通过运行环境提供。

下文是上游 boardgame.io 的项目说明。本项目保留上游 [MIT 许可证](LICENSE)。

<p align="center">
  <a href="https://boardgame.io/">
    <img src="https://raw.githubusercontent.com/boardgameio/boardgame.io/main/docs/logo-optimized.svg?sanitize=true" alt="boardgame.io" />
  </a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/boardgame.io"><img src="https://badge.fury.io/js/boardgame.io.svg" alt="npm version" /></a>
<a href="https://github.com/boardgameio/boardgame.io/actions?query=workflow%3ATests"> <img src="https://github.com/boardgameio/boardgame.io/workflows/Tests/badge.svg" alt='Build Status'></a>
<a href='https://coveralls.io/github/boardgameio/boardgame.io?branch=main'><img src='https://coveralls.io/repos/github/boardgameio/boardgame.io/badge.svg?branch=main' alt='Coverage Status' /></a>
<a href="https://gitter.im/boardgame-io"><img src="https://badges.gitter.im/boardgame-io.svg" alt="Gitter" /></a>
</p>

<p align="center">
  <strong><a href="https://boardgame.io/documentation/#/">Read the Documentation</a></strong>
</p>

<p align="center">
  <strong>boardgame.io</strong> is an engine for creating turn-based games using JavaScript.
</p>

Write simple functions that describe how the game state changes
when a particular move is made. This is automatically converted
into a playable game complete with online multiplayer
features, all without requiring you to write a single line of
networking or storage code.

### Features

- **State Management**: Game state is managed seamlessly across clients, server and storage automatically.
- **Multiplayer**: Game state is kept in sync in realtime and across platforms.
- **AI**: Automatically generated bots that can play your game.
- **Game Phases**: with different game rules and turn orders per phase.
- **Lobby**: Player matchmaking and game creation.
- **Prototyping**: Interface to simulate moves even before you render the game.
- **Extendable**: Plugin system that allows creating new abstractions.
- **View-layer Agnostic**: Use the vanilla JS client or the bindings for React / React Native.
- **Logs**: Game logs with the ability to time travel (viewing the board at an earlier state).

## Usage

### Installation

```sh
npm install boardgame.io
```

### Documentation

Read our [Full Documentation](https://boardgame.io/documentation/) to learn how to
use boardgame.io, and join the [community on gitter](https://gitter.im/boardgame-io/General)
to ask your questions!

### Running examples in this repository

```sh
npm install
npm start
```

The examples can be found in the [examples](examples/) folder.

#### Using VS Code?

This repository is ready to run in a dev container in VS Code. See [the contributing guidelines for details](CONTRIBUTING.md).

## Changelog

See [changelog](docs/documentation/CHANGELOG.md).

## Get involved

We welcome contributions of all kinds!
Please take a moment to review our [Code of Conduct](CODE_OF_CONDUCT.md).

🐛 **Found a bug?**  
Let us know by [creating an issue][new-issue].

❓ **Have a question?**  
Our [Gitter channel][gitter] and [GitHub Discussions][discussions]
are good places to start.

⚙️ **Interested in fixing a [bug][bugs] or adding a [feature][features]?**  
Check out the [contributing guidelines](CONTRIBUTING.md)
and the [project roadmap](roadmap.md).

📖 **Can we improve [our documentation][docs]?**  
Pull requests even for small changes can be helpful. Each page in the
docs can be edited by clicking the “Edit on GitHub” link at the top right.

[new-issue]: https://github.com/boardgameio/boardgame.io/issues/new/choose
[gitter]: https://gitter.im/boardgame-io/General
[discussions]: https://github.com/boardgameio/boardgame.io/discussions
[bugs]: https://github.com/boardgameio/boardgame.io/issues?q=is%3Aissue+is%3Aopen+label%3Abug
[features]: https://github.com/boardgameio/boardgame.io/issues?q=is%3Aissue+is%3Aopen+label%3Afeature
[docs]: https://boardgame.io/documentation/
[sponsors]: https://github.com/sponsors/boardgameio
[collective]: https://opencollective.com/boardgameio#support

## License

[MIT](LICENSE)
