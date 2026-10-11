# 改动说明

<!-- 一句话说清这次改了什么、为什么改。 -->

## 类型

- [ ] 新功能（feat）
- [ ] 修 Bug（fix）
- [ ] 文档 / 注释（docs）
- [ ] 重构 / 清理（refactor）
- [ ] 测试（test）

## 改了什么

<!-- 逐条列出。涉及界面的话，说明在哪个面板/哪个操作路径。 -->

-
-

## 怎么验证

<!-- 贴出实际跑过的命令与结果，别只写"应该没问题"。 -->

```powershell
node tools\smoke.mjs      # 纯逻辑 + HTTP 接口
node tools\ui-test.mjs    # 真实浏览器交互（Edge 无头 + 真实鼠标事件）
```

结果：

- [ ] `tools/smoke.mjs` 全部通过
- [ ] `tools/ui-test.mjs` 全部通过
- [ ] 手动打开页面确认过（说明：）

## 检查清单

- [ ] **没有提交私人图谱数据**（`graphs/*.json` 已被 `.gitignore` 排除；请勿用 `-f` 强加）
- [ ] 没有提交 `*.bak` / `*.tmp` / 日志等杂物
- [ ] 如果改了界面手势，已同步更新 `README.md`
- [ ] 如果改了行为，已在 `CHANGELOG.md` 追加一条

## 相关 Issue

<!-- 例如 Closes #12；没有就删掉这节。 -->
