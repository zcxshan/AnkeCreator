# 验收清单：安科作品 10 项修复与资源库增强

- 对应 Spec：`docs/superpowers/specs/2026-11-24-anke-10fix-spec.md`
- 对应 Tasks：`docs/superpowers/plans/2026-11-24-anke-10fix-tasks.md`
- 版本号保持 `4.0.0`

## 1. 空节导出/导入（第 1 项）
- [x] 导出时 `content == null` 归一化为 `''`，不再抛错中断
- [x] 10 节中 1 节为空时，导出仍为 10 节且该节 `content === ''`
- [x] 导入三条节创建路径均使用 `content: sec?.content ?? ''`
- [x] `storyExportBundle.test.ts` / `storyImport.test.ts` 通过

## 2. 每节内容独立（第 2 项）
- [x] 编辑回传携带归属 `sectionId`
- [x] store 收到跨节回传时直接丢弃
- [x] `editorStore.test.ts` 覆盖跨节丢弃与同节正常保存

## 3. 切节覆盖 Bug（第 3 项）
- [x] `editor.setEditable(editable, false)`，切节不再触发 `update`
- [x] `appliedSectionIdRef` 在 `onCreate` 与每次内容应用后同步
- [x] `onUpdate` 仅在归属节与当前节一致时回传

## 4. 默认 0 楼（第 4 项）
- [x] 收集安科/收集安价默认起始楼层为 `'0'`
- [x] 楼层校验允许 0、拒绝负数，文案为「楼层数必须为非负整数」
- [x] 输入框 `min={0}`，起始楼层标注「NGA 含 0 楼」
- [x] `useNgaCollectCommon.test.ts` 断言默认 `'0'`

## 5. 导入安价 × 收集安价（第 5 项）
- [x] 弹窗支持「粘贴文本 / 收集历史」双来源
- [x] 选择历史记录可回填并生成选项
- [x] 工具栏按钮文案与 tooltip 更新
- [x] `DiceNGAImportDialog.test.tsx` 通过

## 6. 图片处理（第 6 项）
- [x] 资源库图片卡片提供「处理图片」入口
- [x] 支持修改宽高（锁比例）、PNG/JPEG/WebP 转换、质量调节
- [x] 保存后写回资源库并刷新列表
- [x] `imageProcess.test.ts` 通过

## 7. 删除快照（第 7 项）
- [x] `deleteSnapshot` 实现并做非法名防护
- [x] IPC `data:deleteSnapshot` + preload 代理
- [x] 设置页每个快照提供删除按钮、确认弹窗、删除后刷新
- [x] `snapshot.test.ts` 覆盖删除成功/幂等/非法名

## 8. BGM 模块（第 8 项）
- [x] 资源库新增 BGM Tab，仅支持输入 URL 添加
- [x] 编辑器右栏图库支持「图片 / BGM」切换并插入正文
- [x] 导出 BBCode 为 `[flash=audio]…[/flash]`
- [x] 导入 `[flash=audio]` 生成 `audio-block` 原子节点
- [x] NGA 附件地址导出时反解为 `./mon_…`
- [x] `bgmLibraryStore.test.ts` 与 BBCode 双向用例通过

## 9. NGA url 头部（第 9 项）
- [x] 设置新增「NGA 的 url 头部」，默认 `https://img.nga.cn/attachments`
- [x] 设置持久化并迁移到 v5
- [x] 图片/BGM 的 `./mon_`、`mon_` 地址自动补全前缀
- [x] 主进程与渲染进程共享前缀（provider 注入，无循环依赖）
- [x] `ngaBBCodeToHtml.test.ts` 覆盖自定义前缀与空值回退

## 10. UI 风格统一（第 10 项）
- [x] 编辑器字体下拉改为贴纸风 `FontPicker`（墨线描边 + 胶囊 + 硬阴影）
- [x] 阅读界面工具栏、抽屉、字号、主题色块统一为阅读主题墨线风
- [x] 搜索/全局搜索面板边框与圆角改用 `--an-*` 令牌
- [x] `EditorToolbar.fontPicker.test.tsx` 通过

## 11. 清理与验证
- [x] 还原自动生成的 `android/capacitor.settings.gradle`
- [x] 清理 `release/ dist/ dist-electron/ diagnostics/ .dev-logs/ .screenshots/ android/app/build/ android/.gradle/ *.tsbuildinfo`
- [x] `npm run typecheck` 通过
- [x] 全量单测通过：84 个文件 / 814 个用例
- [x] `npx vite build` 通过
