# OW英雄更新历史

面向 Windows 的《守望先锋》英雄更新与职业比赛资料库。应用将官方补丁、英雄改动、职业比赛、战队、选手、地图和赛后阵容记录保存在本地，后续同步只获取新增内容。

> 我只想看看中国区什么时候能拿冠军。Shy，三角洲好玩吗？宫教练也太棒了。

## 功能

### 英雄更新历史

- 从英雄登场时间开始展示增强、削弱、重做及系统/地形影响。
- 区分正式核心、威能系统、角斗领域、实验/测试和限时娱乐版本。
- 支持短全图、长树图、筛选、搜索、缩放与 JSON 导出。
- 支持 PC 与主机调整选项，默认只统计 PC。
- 英雄阵容和头像可在线更新，中英文界面跟随软件语言。
- 启动时及每 6 小时同步英文/繁体中文官方英雄阵容；未知的新英雄无需改写内置名单即可显示名称、头像与职责。

### 职业比赛资料库

- 收录 OWTV、OW Esports、Stats Lab 及 2025 社区赛后阵容档案。
- 提供赛事、比赛、战队、选手、英雄和地图多级查询。
- 显示比赛比分、地图、禁用、选手数据及可用的 OWTV/B站/YouTube/Twitch 链接。
- 战队英雄记录以赛后结算英雄为主、正伤害记录为辅。
- 2025 社区阵容会明确标注证据选手和地图；OWTV 链接仅用于核对对阵与地图，不将英雄禁用图标当作出场英雄。
- 历史档案保存在本地，启动时不重复下载完整数据。
- 比赛与选手数值默认读取本地 OWTV；Stats Lab、社区赛后阵容分开选择，不混加。
- 缺失数值显示“—”，部分地图有数据时显示覆盖数量；升级安装包会合并新快照，保留用户新增比赛。

### 本地比赛库（2026-10-06 更新）

共 **1,308 场比赛、3,856 张地图、33,452 条选手逐图记录**，比上一版新增 264 场比赛。最新已结束比赛为 2026 年 10 月 6 日；新增的赛果、选手记录和头像随安装包提供，无需用户重新下载。

947 场有选手逐图记录，其中 735 场提供了伤害、击杀或治疗数值。另有 47 场的源站详情链接异常，只保留赛程和已知赛果；22 场源站比分不完整，仍按缺失显示。具体覆盖和核验记录见[比赛数据记录](docs/owtv-data-2026-10-06.md)。

## 中国赛区国际赛事成绩

统计截止：2026-08-09

| 年份 | 赛事 | 队伍 | 成绩 |
| --- | --- | --- | --- |
| 2024 | 电竞世界杯 | LGD.OA | 第 9—12 名（赛事未设置 9—12 名排位赛） |
| 2025 | Champions Clash | Once Again | 第 4 名 |
| 2025 | 季中冠军赛 | Weibo Gaming | 第 9—12 名（赛事未设置 9—12 名排位赛） |
| 2025 | 年终总决赛 | Weibo Gaming | 第 5—6 名（赛事未设置 5—6 名排位赛） |
| 2026 | Champions Clash | Weibo Gaming | 第 5—6 名（赛事未设置 5—6 名排位赛） |
| 2026 | 季中冠军赛 | Weibo Gaming | 第 4 名 |

**数据范围：** Stats Lab（2018—2023）；赛事结果（2024）；OWTV 逐场比赛、地图与选手统计（2025—2026）。

逐年结果参考：[LGD.OA 2024 赛绩](https://liquipedia.net/overwatch/Once_Again)、[Weibo Gaming 2025 国际赛回顾](https://owtv.gg/news/weibo-gaming-new-improved-and-ready-to-take-on-the-world)、[2026 季中冠军赛](https://owtv.gg/tournaments)。

| 统计项 | 成绩 |
| --- | --- |
| 中国国家队世界杯 | 0 冠、3 亚（2018、2019、2023） |
| 中国城市席位全年总冠军 | 上海龙之队，2021 守望先锋联赛总冠军 |
| 中国城市席位跨赛区/洲际冠军 | 8 次：上海龙之队 6 次、广州冲锋 1 次、Team CC 1 次 |
| 中国选手核心阵容跨区冠军 | Team CC，2020 挑战者系列赛亚洲 Gauntlet 冠军 |

参考：[中国队与 2026 世界杯](https://esports.overwatch.com/en-us/news/overwatch-world-cup-2026)、[上海龙之队赛绩](https://liquipedia.net/overwatch/Shanghai_Dragons)、[Team CC 赛绩](https://liquipedia.net/overwatch/Team_CC)、[2020 守望先锋联赛](https://liquipedia.net/overwatch/Overwatch_League/2020)。

## 开发

需要 Node.js、Rust 与 Tauri 的 Windows 构建环境。

```powershell
npm.cmd install
npm.cmd run dev
```

## 构建 Windows EXE

```powershell
npm.cmd run build
npm.cmd run tauri build
```

安装包输出目录：

```text
src-tauri\target\release\bundle\nsis\
```

## 测试

```powershell
npm.cmd test
npm.cmd run dev -- --host 127.0.0.1 --port 4181
python tests\ui_usage_regression.py
python tests\team_hero_source_consistency.py
```

后三条命令中，开发服务器与 Playwright 脚本分别在两个终端运行。排序单元测试覆盖比赛时间、赛事名次、同分次序、时区日期和无效日期；UI 回归覆盖筛选、排序、比赛详情与英雄/战队/选手下钻；数据一致性回归逐场比对战队英雄排行、比赛记录和来源快照。

## 数据说明

- 仓库包含应用运行所需的压缩本地快照。
- 构建和离线运行所需的 `data/owtv/owtv.sqlite3` 随仓库保存；其他采集工作库、赛事工作簿、Stats Lab 压缩包和临时视频不纳入 Git。采集与转换脚本位于 `tools/`。
- 英雄更新主要来源于暴雪官方补丁页面。
- OWTV 部分旧比赛只有对阵、比分、地图或禁用信息，不一定提供英雄阵容及伤害数据。

## 主要数据来源

- [Overwatch 官方补丁](https://overwatch.blizzard.com/zh-tw/news/patch-notes/)
- [守望先锋国服官网](https://ow.blizzard.cn/)
- [Overwatch Esports](https://esports.overwatch.com/)
- [OWTV](https://owtv.gg/)
- [OverFast API](https://overfast-api.tekrop.fr/)

## 当前版本

`v0.10.38`

## 赞赏与交流

如果软件对你有帮助，可以通过下方赞赏码支持后续的数据维护、比赛核验与功能开发。

![赞赏码](docs/sponsor.jpg)

问题反馈与交流 QQ 群：`1012969672`。
