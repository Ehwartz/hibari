# 雲雀 Hibari — AI 麻雀训练场

Hibari 是一款日本麻将（四人立直麻将）训练软件。玩家与三名 Mortal AI 对局，
对局自动保存为牌谱，并支持牌谱回放、AI 复盘、何切 / 听牌 / 点数练习与数据统计。

设计说明与开发进度见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 模型权重

本仓库不包含 Mortal 模型权重。运行前请将权重文件放置于：

```
mjbot_mortal/mortal.pth
```

缺少该文件时 AI 无法加载，对局与复盘功能均不可用。也可以在「设置 → AI 程序」中
将 bot 路径指向其他 Akagi 格式的 Mortal 目录（须包含 `model.py` 与权重文件），
重启程序后生效。

## 运行环境

- Windows 10 / 11（64 位）
- Python 3.12，使用 [uv](https://docs.astral.sh/uv/) 管理依赖
- Node.js，用于构建前端
- Google Chrome 或新版 Microsoft Edge

## 安装与启动

```powershell
python -m uv sync
cd frontend; npm install; cd ..
.\start.cmd
```

`start.cmd` 启动后端服务并打开程序窗口。开发时使用 `dev.cmd`，运行测试使用
`python -m uv run pytest`。

## 数据存储

牌谱、设置、头像与练习记录保存在 `data/` 目录中。牌谱目录可在设置中更改。

## 打包发布

```powershell
python -m uv run python -m scripts.build_release
```

生成免安装版本 `release/Hibari-<版本>-win64.zip`，内置 Python 运行环境，
解压后运行 `Hibari.exe` 即可使用。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
中的 “Portable release” 一节。

## 许可证

本项目以 [GNU AGPL-3.0](LICENSE) 发布。本项目在进程内调用以 AGPL-3.0 授权的
Mortal 与 libriichi，因此整体采用相同许可证。

模型权重不属于本仓库，不受本仓库许可证约束。

## 致谢

- [Mortal](https://github.com/Equim-chan/Mortal)：AI 模型与 libriichi，AGPL-3.0
- [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)：牌面图，CC0
- [mahjong](https://github.com/MahjongRepository/mahjong)：点数计算，MIT
