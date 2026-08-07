# OW英雄更新历史

面向 Windows 的《守望先锋》英雄更新与职业比赛资料库。应用将官方补丁、英雄改动、职业比赛、战队、选手、地图和赛后阵容记录保存在本地，后续同步只获取新增内容。

## 功能

### 英雄更新历史

- 从英雄登场时间开始展示增强、削弱、重做及系统/地形影响。
- 区分正式核心、威能系统、角斗领域、实验/测试和限时娱乐版本。
- 支持短全图、长树图、筛选、搜索、缩放与 JSON 导出。
- 支持 PC 与主机调整选项，默认只统计 PC。
- 英雄阵容和头像可在线更新，中英文界面跟随软件语言。

### 职业比赛资料库

- 收录 OWTV、OW Esports、Stats Lab 及 2025 社区赛后阵容档案。
- 提供赛事、比赛、战队、选手、英雄和地图多级查询。
- 显示比赛比分、地图、禁用、选手数据及可用的 OWTV/B站/YouTube/Twitch 链接。
- 战队英雄记录以赛后结算英雄为主、正伤害记录为辅。
- 2025 社区阵容会明确标注证据选手和地图；OWTV 链接仅用于核对对阵与地图，不将英雄禁用图标当作出场英雄。
- 历史档案保存在本地，启动时不重复下载完整数据。

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

## 数据说明

- 仓库包含应用运行所需的压缩本地快照。
- 原始 SQLite、赛事工作簿、Stats Lab 压缩包和临时视频不纳入 Git；采集与转换脚本位于 `tools/`。
- 英雄更新主要来源于暴雪官方补丁页面。
- OWTV 部分旧比赛只有对阵、比分、地图或禁用信息，不一定提供英雄阵容及伤害数据。

## 主要数据来源

- [Overwatch 官方补丁](https://overwatch.blizzard.com/zh-tw/news/patch-notes/)
- [守望先锋国服官网](https://ow.blizzard.cn/)
- [Overwatch Esports](https://esports.overwatch.com/)
- [OWTV](https://owtv.gg/)
- [OverFast API](https://overfast-api.tekrop.fr/)

## 当前版本

`v0.10.34`

## ?????

???????????????????????????????????????????????????????

![????](docs/sponsor.jpg)

??????????`1012969672`?

