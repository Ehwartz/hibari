# 在 Akagi 的 Mortal 基础上继续训练

用 [Mortal](https://github.com/Equim-chan/Mortal) 官方的在线训练流程，从 Akagi 提供的
`mjbot_mortal/mortal.pth` 出发，训练不同风格（避四 / 平衡 / 争一）的模型。

## 文件

| 文件 | 作用 |
|---|---|
| `make_config.py` | 生成 Mortal 的 `config.toml`：风格（`--style`）、规模（`--scale pilot/full`）、设备 |
| `prepare.py` | 把 `mortal.pth` 整理成 `baseline.pth`（固定的对手）和 `trainee.pth`（学生的起点） |
| `pilot.py` | 端到端试点：1v3 自我对战 → GRP 训练 → 在线训练，并输出各环节速度 |
| `mortal_shim/` | 运行时修正，不改 Mortal 代码：GPU 上让子进程用 spawn 启动（避免 CUDA 初始化错误），CPU 上屏蔽只有 GPU 才有的调用 |
| `setup_remote.sh` | 在租用的 Linux GPU 机器上一键装好环境（国内平台自动用国内镜像） |
| `TRAINING_NOTES.md` | 训练记录：做了什么、怎么做的、遇到的问题和测得的数据（英文） |
| `speedtest.py` | 正式规模的速度测试（1 到 N 个对局端） |
| `overnight.py` | 无人值守：GRP 牌谱 → GRP → 在线训练到截止时间，可自动关机 |
| `Mortal/` | Mortal 仓库的 clone（不提交） |
| `runs/` | 每次训练的工作目录（不提交） |

## 流程

1. **GRP 牌谱**：基准模型四家互打（libriichi 的 1v3 对战）。
2. **GRP**：用这些牌谱训练顺位预测器，用来把每局的结果折算成奖励。
3. **在线训练**：server + 对局端 client + 训练端 train.py 同时运行。学生（1 家）对 3 家固定的
   基准模型自我对战，训练端用学生那一家的决策更新参数，再发回给对局端。

风格由 `[env] pts`（各顺位得分）决定。Akagi 的模型训练时用的是 `[3, 1.5, 0, -4.5]`，
即天凤段位分 90/45/0/-135 的比例，本身就偏避四。

## 本地（Windows，CPU）

```powershell
cd train_mortal
git clone --depth 1 https://github.com/Equim-chan/Mortal.git
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe "torch==2.8.*" --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv\Scripts\python.exe toml tqdm tensorboard numpy
copy ..\mjbot_mortal\libriichi\libriichi-3.12-x86_64-pc-windows-msvc.pyd Mortal\mortal\libriichi.pyd
.venv\Scripts\python.exe pilot.py
```

CPU 只用来验证流程能跑通，速度没有参考价值。

## 租用的 GPU 机器（Linux）

libriichi 需要从源码编译（Akagi 预编译的 Linux 版要求 glibc 2.39 以上）：

```sh
# Rust 和编译工具
curl https://sh.rustup.rs -sSf | sh -s -- -y && . "$HOME/.cargo/env"
git clone --depth 1 https://github.com/Equim-chan/Mortal.git && cd Mortal
cargo build -p libriichi --lib --release && cp target/release/libriichi.so mortal/
cd ..
python3 -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cu128   # RTX 4090 / 5090
pip install toml tqdm tensorboard numpy
# 上传 mortal.pth 到 ../mjbot_mortal/mortal.pth（或用 prepare.py --weights 指定）
python pilot.py --device cuda:0 --amp      # 先试点，记下各环节速度
```

正式训练（以避四为例）：

```sh
python make_config.py --work runs/avoid4 --style avoid4 --scale full --device cuda:0 --amp
python prepare.py --work runs/avoid4 --amp
export MORTAL_CFG=$PWD/runs/avoid4/config.toml
export PYTHONPATH=$PWD/mortal_shim     # 必须：运行时修正，见 mortal_shim/sitecustomize.py
cd Mortal/mortal
python one_vs_three.py            # GRP 牌谱（games_per_iter 局）
python train_grp.py               # 训练 GRP，loss 稳定后 Ctrl+C
python server.py &                # 在线训练：三个进程
python train.py &
python client.py &                # 对局端，可以开多个
tensorboard --logdir ../../runs/avoid4/tensorboard
```

训练端每 `test_every` 步会和基准模型打一批测试局，在 TensorBoard 里看平均顺位和各顺位比例。
`runs/<风格>/trainee.pth` 和 `best.pth` 就是训练出的模型，放进 Hibari 的 bot 文件夹即可使用。

## 注意

- `mortal.pth` 的来源和授权不明确，由它训练出的模型同样只适合自用，不要公开分发。
- 训练出的模型只在 Hibari 里练习用，不要用于天凤、雀魂等平台的段位场。
