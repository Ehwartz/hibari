# 雲雀 Hibari — AI 麻雀训练场

Hibari 是一款日本麻将（四人立直麻将）训练软件。玩家与三名 Mortal AI 对局，
对局自动保存为牌谱，并支持牌谱回放、AI 复盘、何切 / 听牌 / 点数练习与数据统计。

设计说明与开发进度见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 模型权重

本仓库不包含 Mortal 模型权重。运行前请将权重文件放置于：

```
mjbot_mortal/mortal.pth
```

可以使用 Hugging Face 上公开的第三方权重
[Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500)：下载
`mortal_582500.pth`，改名为 `mortal.pth` 后放到上述位置。

- SHA-256：`738e0d6e3c0ce9671629554ad39abd147d2ffbac676e80b194c83f2acc0fea20`
- 该权重由第三方发布，模型卡标注 AGPL-3.0。本项目不分发它，也未核实其训练数据来源与授权，
  使用前请自行阅读模型卡并判断。

缺少该文件时 AI 无法加载，对局与复盘功能均不可用。也可以在「设置 → AI 程序」中
将 bot 路径指向其他 Akagi 格式的 Mortal 目录（须包含 `model.py` 与权重文件），
重启程序后生效。

## 运行环境

| 系统 | 支持情况 |
|---|---|
| Windows 10 / 11（x64） | 支持 |
| macOS（Apple Silicon） | 支持 |
| Linux（x86_64，glibc 2.39 以上，如 Ubuntu 24.04、Debian 13、Fedora 40） | 支持 |
| macOS（Intel）、ARM 版 Linux / Windows、较旧的 Linux 发行版 | 不支持（缺少对应的 PyTorch 或 libriichi 预编译包） |

另需：

- Python 3.12，使用 [uv](https://docs.astral.sh/uv/) 管理依赖
- Node.js，用于构建前端
- Google Chrome、Microsoft Edge 或 Chromium

## 安装与启动

Windows：

```powershell
python -m uv sync
cd frontend; npm install; cd ..
.\start.cmd
```

macOS / Linux：

```sh
uv sync
(cd frontend && npm install)
./start.sh
```

macOS 也可以在访达中双击 `start.command`。

启动脚本会启动后端服务，并以应用窗口形式打开界面；关闭窗口即退出程序。
在 macOS 上关闭窗口后浏览器进程仍会保留，请按 Cmd+Q 退出。未安装 Chromium
内核浏览器时，界面会在系统默认浏览器中打开。

开发时使用 `dev.cmd`（Windows）或 `./dev.sh`（macOS / Linux）。运行测试使用
`uv run pytest`。

## 数据存储

牌谱、设置、头像与练习记录保存在 `data/` 目录中。牌谱目录可在设置中更改。

## 打包发布

```sh
uv run python -m scripts.build_release
```

在当前系统上生成免安装版本，内置 Python 运行环境：

| 系统 | 产物 | 启动方式 |
|---|---|---|
| Windows | `release/Hibari-<版本>-win64.zip` | `Hibari.exe` |
| macOS | `release/Hibari-<版本>-macos-arm64.zip` | `Hibari.app` |
| Linux | `release/Hibari-<版本>-linux-x86_64.tar.gz` | `start.sh` |

GitHub Actions 会在三个系统上分别运行测试、打包并验证安装包，产物可在 Actions
页面下载；推送 `v*` 标签时自动发布到 Releases。CI 构建的安装包不含模型权重，可用
以下命令补入权重（及本机设置的 AI 头像），结果写入 `release/full/`：

```sh
uv run python -m scripts.add_weights <安装包路径>
```

`uv run python -m scripts.smoke_release <安装包路径>` 可在全新目录中解压并验证安装包。
详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 中的 “Portable release” 一节。

## 许可证

本项目以 [GNU AGPL-3.0](LICENSE) 发布。本项目在进程内调用以 AGPL-3.0 授权的
Mortal 与 libriichi，因此整体采用相同许可证。

模型权重不属于本仓库，不受本仓库许可证约束。`frontend/src/assets/voice/` 中的语音文件
同样不受 AGPL-3.0 约束，其使用须遵循上述音源利用规约并保留署名。

## 致谢

- [Mortal](https://github.com/Equim-chan/Mortal)：AI 模型与 libriichi，AGPL-3.0
- [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)：牌面图，CC0
- [mahjong](https://github.com/MahjongRepository/mahjong)：点数计算，MIT
- 语音：VOICEVOX:四国めたん、VOICEVOX:ずんだもん、VOICEVOX:九州そら、VOICEVOX:東北きりたん
  （由 [VOICEVOX](https://voicevox.hiroshiba.jp/) 生成，遵循[東北ずん子・ずんだもんプロジェクトの音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)；
  生成脚本 `scripts/make_voices.py`）
