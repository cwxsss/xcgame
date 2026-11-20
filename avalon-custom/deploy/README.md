# Release and deployment guide

[Documentation index](../docs/README.md) · [Development](../docs/development.md)

Publication and live deployment are separate operations. Repository configuration
cannot identify the version currently running on a VM; verify it with the operator.
The development Compose file is not the production topology.

## GitHub release publication

`.github/workflows/publish.yml` runs on a pushed `v*.*.*` tag or manual dispatch
with an existing version tag. The resolver validates that tag and pins its commit.
Publication is serialized without cancelling an active release.

Required repository configuration:

| Kind     | Name                      | Purpose                                          |
| -------- | ------------------------- | ------------------------------------------------ |
| Variable | `DOCKER_HUB_USERNAME`     | Container repositories and registry build caches |
| Secret   | `DOCKER_HUB_ACCESS_TOKEN` | Docker Hub login                                 |

The workflow checks mounted nginx compatibility, then builds the backend and UI.
The UI is exported from the `release-artifact` target, validated using production
nginx routing, and all hashed images are included in the same UI artifact
packaged into the nginx image. No Yandex Storage credentials are needed. Image names:

- `<DOCKER_HUB_USERNAME>/backend-avalon:<version-tag>`
- `<DOCKER_HUB_USERNAME>/nginx-avalon:<version-tag>`

Both builds reuse separate Docker Hub `buildcache` tags. After both publications
succeed, a cleanup job removes only obsolete version-tag BuildKit caches from
GitHub Actions. Details and manual recovery:
[UI release guide](../packages/ui/README.md#images-served-by-the-application-server).
A failed UI image audit must be corrected before deploying that UI.

### GitHub Actions storage quota

Release images and build caches are stored in Docker Hub. The UI export stays
on the build runner and is packaged there; no GitHub artifact transfer is needed.
`DOCKER_BUILD_RECORD_UPLOAD=false` disables the optional `.dockerbuild`
diagnostic uploads from Docker's build action. Normal workflow logs remain available.
See [Docker build action environment variables](https://github.com/docker/build-push-action/tree/v6#environment-variables).

If a storage alert arrives, check the latest Publish and Deploy run results before
assuming releases are blocked. Continue the normal release process while runs
are allowed. Merge the workflow change before pushing a new release tag; retrying
an old run still uses its old workflow. For an existing tag, manually dispatch
Publish from the updated `master` branch with that tag as input.

Deleting old artifacts reduces current storage but does not erase storage already
accrued during the billing cycle; usage reporting can take 6–12 hours to update.
The quota belongs to the repository owner and may also include other repositories
and GitHub Packages. Build caches have a separate allowance, so deleting caches
does not free the artifact allowance. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

If GitHub blocks runners with a billing error, this workflow change cannot unblock
them. The account owner can allow paid Actions usage with a payment method and a
bounded budget with **Stop usage when budget limit is reached**, or wait for the
next billing cycle. Without paid Actions, an operator can build and audit both
images locally using the same Dockerfiles and `linux/amd64` platform, publish new
version tags to Docker Hub, and invoke the existing restricted SSH deployment
entry point with an authorized key (see [deployment access](firstbyte/DEPLOY.md#access-and-server-installation)).
Preserve the nginx/UI audits and deployment safeguards; do not build on the
production server or overwrite an existing release tag.

The root `npm version` lifecycle runs tests, updates workspace versions, stages
files, pushes commits and pushes its version tag. Inspect the worktree and
release contents before invoking it; documentation edits alone do not need a new
container release.

## Live rollout

1. Confirm the selected release publication succeeded and both image tags exist.
2. Back up the target database and verify the backup according to the backup guide.
3. Preserve production secrets, volumes and existing network/certificate settings.
   Configure required flags and Compose fragments before switching images.
4. Wait for human and AI games to finish. Backend recreation disconnects active games.
5. Pull the selected images. FirstByte's manual deploy stages and atomically
   switches frontend files inside the running nginx gateway and recreates only
   backend. Do not recreate `ui` during ordinary application releases; see the
   [manual deployment guide](firstbyte/DEPLOY.md). A restart alone does not select
   a new backend image.
6. Check backend startup/migrations, homepage, room/socket access and relevant APIs.
   Run public SEO HTTP checks after a UI/nginx update.

Rollback must preserve database volumes, migration markers, AI ledgers, stored
image objects and authentication state. Check schema compatibility before using
an old backend; some migrations/authorization changes cannot simply be reversed.

## Operational guides

- [Backend environment and precedence](../docs/environment.md)
- [Database migrations](../docs/database-migrations.ru.md)
- [Database backup/restore](voice/database-backups.md)
- [Mounted nginx configuration compatibility](nginx/README.md)
- [Voice beta topology and rollout](../docs/voice-chat.md)
- [Codex-only AI configuration and rollout](ai-production.md)
- [Codex local container / remote SSH worker](codex-production.md)
- [Password recovery](../docs/password-recovery.md) and [Russian production runbook](../docs/production-password-recovery.ru.md)
- [Direct crypto support](../docs/payments/direct-crypto.md)

Compose fragments are examples to merge into the existing deployment, not
standalone commands that replace the production stack. Historical VM preparation
notes describe their recorded date and do not confirm current deployment status.

## Infrastructure privacy

Keep real host addresses, provider account IDs, SSH host keys and operational
incident/rollback records outside Git. Store CI connection values in the
`production` environment Secrets; keep host runtime configuration and backups
private. `.private-ops/` is ignored for local operator notes. Use example hosts
and documentation-only IP addresses in public guides. Removing a value from the
current tree does not remove it from earlier Git commits.
## 小褚游戏厅

合并入口将原游戏厅和宝石商人保留在根路径，新版阿瓦隆使用 `/avalon/`。

1. 在 `boardgame.io` 构建并启动原游戏厅。设置 `TABLETOP_AVALON_PATH=/avalon/`，使用原有的 `TABLETOP_ACCESS_PASSWORD` 和 `TABLETOP_ACCESS_SECRET`，将 `BOARDGAME_ORIGIN` 设为合并入口的 URL。
2. 在 `avalon-custom` 运行 `npm run build:hall-ui`，通过现有 MongoDB 配置启动新版阿瓦隆后端。
3. 将 `AVALON_WEB_ROOT` 指向 `packages/ui/dist-hall`，运行 `npm run start:hall`。入口默认监听 `127.0.0.1:18996`，原游戏厅和阿瓦隆后端默认分别使用 `127.0.0.1:18997` 和 `127.0.0.1:3000`，可用 `TABLETOP_UPSTREAM` 和 `AVALON_UPSTREAM` 指定。

如需启用大厅房间管理，在阿瓦隆后端的私有环境文件中配置 `XCGAME_ROOM_ADMIN_PASSWORD`。管理员验证绑定当前已登录的连接，最长有效八小时。删除会关闭活动房间并在 MongoDB 中记录大厅移除标记。已经保存的对局历史仍可访问。

普通阿瓦隆房间使用 MongoDB 私有快照恢复等待中的配置和进行中的对局。进行中对局从最近一次保存成功的操作恢复。首次部署带快照的版本前，等现有对局打完再重启后端，旧版创建的活动房间缺少恢复数据。

计划重启通过服务管理器发送 `SIGTERM`。后端停止接收新的游戏操作，等待已接收的操作和房间写入完成后退出。服务管理器的停止超时需大于应用的 25 秒保存期限。

对外只提供合并入口。两个上游保留在回环地址。原游戏厅的入口 Cookie 同时用于保护新版阿瓦隆页面和联机连接。

阿瓦隆语音使用现有 LiveKit 服务。按 `deploy/voice/livekit.yaml.example` 配置媒体服务，在阿瓦隆后端设置 `VOICE_ENABLED=true`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`、`LIVEKIT_INTERNAL_URL`、`LIVEKIT_PUBLIC_URL` 和 `VOICE_GATEWAY_PORT`。同源部署时，将 `LIVEKIT_PUBLIC_URL` 设为大厅的 WebSocket 源地址，合并入口的 `AVALON_VOICE_UPSTREAM` 指向语音网关的内部 HTTP 地址。生产环境使用 `wss://`，并按 LiveKit 的配置开放媒体端口。
