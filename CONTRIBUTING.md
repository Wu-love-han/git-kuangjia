# PR 工作流（main 已被保护：必须走 PR，不能直接推）

这个仓库的 `main` 分支启用了 repository ruleset：**任何改动都必须通过 Pull Request**，
强推与删分支也被禁止，且**没有任何旁路**（仓库主人也不例外）。

## 日常三步

```powershell
# 1) 从最新 main 开一个分支（名字说清干什么）
git checkout main
git pull
git checkout -b feat/你的改动

# 2) 改代码 + 跑自检 + 提交
node tools\smoke.mjs
node tools\ui-test.mjs
git add -A
git commit -m "feat: 一句话说清改了什么"

# 3) 推分支并开 PR（脚本会自动创建 PR）
powershell -ExecutionPolicy Bypass -File tools\open-pr.ps1
```

`tools/open-pr.ps1` 会：推送当前分支 → 调用 GitHub API 创建 PR → 打印 PR 链接。
之后在网页上点 **Merge** 合入 `main`（合并后源分支会自动删除）。

## 私人数据不会被提交

`.gitignore` 已排除：

```
graphs/*.json     # 你的图谱内容（私人笔记）
*.bak  *.tmp  *.log  *.orig-bak
node_modules/
```

**不要用 `git add -f graphs/xxx.json` 强加**——那会把它推上公开仓库。
`tools/open-pr.ps1` 在推送前会检查暂存区，发现 `graphs/*.json` 或 `*.bak` 会直接中止。

## 用自己的 AI 更新图谱后，怎么传上来测试

图谱文件（`graphs/*.json`）**不进 git**，所以"更新图谱"不是提交图谱本身，而是：

1. 让 AI（或你手工）改 `graphs/` 下某个 json；
2. 在**本工具页面**里打开它确认画出来正常（节点、连线、标签、布局）；
3. 如果你改的是**工具代码**（`app/`、`tools/`），走上面的 PR 三步；
4. 如果你只是想把图谱备份/同步到 GitHub，用单独的**私有仓库**或 release 附件——
   **不要**放进这个公开仓库（本仓库只放代码）。

## 验证这套规则是否仍生效

```powershell
git checkout main
git commit --allow-empty -m "should be blocked"
git push origin main      # 期望被拒：Changes must be made through a pull request
git reset --hard HEAD~1    # 本地撤回这次测试提交
```
