import { useState } from 'react';

interface TutorialPageProps {
  onBack: () => void;
  onShowAuthor?: () => void;
}

interface TutorialStep {
  title: string;
  description: string;
}

interface TutorialTopic {
  id: string;
  icon: string;
  title: string;
  summary: string;
  steps: TutorialStep[];
}

const TUTORIAL_TOPICS: TutorialTopic[] = [
  {
    id: 'basics',
    icon: '🎲',
    title: '基础操作',
    summary: '创建作品、编辑段落、插入骰子',
    steps: [
      { title: '1. 创建你的第一个安科作品', description: '在首页点击「新建安科」，输入标题后点击「创建」。新建的作品会自动保存，下次启动应用时可以从「我的作品」中重新打开。' },
      { title: '2. 编辑正文内容', description: '在编辑器中，每个章节都有独立的富文本编辑区。直接输入文字，按回车键换行。点击上方工具栏可以设置加粗、斜体、删除线、文本颜色等样式。' },
      { title: '3. 插入骰子', description: '在工具栏找到「🎲 骰子」按钮，点击后弹出骰子配置面板。选择数值骰子或选项骰子。数值骰子支持简单模式（NdM±K）和表达式模式（四则运算，如 <code>2*3d100</code>、<code>1d10+2d50</code>、<code>1d100+50</code>），选项骰子可自定义面数和选项命中内容。配置后点击确定，骰子卡片会插入到光标位置。点击卡片上的「投掷」按钮即可模拟掷骰。' },
      { title: '4. 管理章节', description: '左侧章节列表可以新增（「+ 新章节」）、重命名（点击章节标题编辑）、删除和调整顺序。点击章节会切换到该章节的编辑内容。' },
      { title: '5. 保存你的作品', description: '内容修改后会自动保存。可以点击左上角的「← 返回首页」回到作品列表，作品不会丢失。所有数据自动保存在本地数据目录中。' },
    ],
  },
  {
    id: 'images',
    icon: '🖼️',
    title: '图片与差分',
    summary: '插入图片、管理人物差分图、从模板导入',
    steps: [
      { title: '1. 插入图片', description: '点击工具栏的「🖼️ 图片」按钮，选择方式有两种：① 本地上传（从电脑选择图片文件）；② URL 粘贴（粘贴图片链接后点击确定）。图片会以原子块的形式插入到光标位置。' },
      { title: '2. 添加人物', description: '在左侧「👤 人物角色」视图中，点击「+ 新建角色」创建新人物。可以设置头像、性格描述、属性（如身高、年龄等）和备注。' },
      { title: '3. 添加差分图', description: '进入人物编辑详情，找到「差分图」区域，点击「添加图片」上传差分（比如：开心、生气、惊讶等不同表情/场景）。每个差分可以设置备注说明。' },
      { title: '4. 插入差分到编辑器', description: '在人物编辑页面中，每个差分图旁边都有「插入」按钮。点击该按钮，差分图会以图片原子块的形式插入到当前章节的光标位置。在右侧人物面板中也可以点击差分缩略图快捷插入。' },
      { title: '5. 从模板库导入人物', description: '在左侧人物面板中，点击「📋 导入」按钮，会显示所有可用的人物模板。点击任意模板即可直接导入到当前作品中（自动重命名避免冲突）。模板可以在首页「模板库」中预先编辑。' },
    ],
  },
  {
    id: 'lists',
    icon: '📋',
    title: '列表与引用',
    summary: '有序/无序列表、引用块',
    steps: [
      { title: '1. 有序列表（1. 2. 3.）', description: '先选中一段或多行文字，点击工具栏的「1. 有序」按钮，选中内容会被包装成有序列表。每一行作为一个列表项。导出为 NGA BBCode 时会自动转换为 [list=1]...[/list]。' },
      { title: '2. 无序列表（• 列表项）', description: '选中多行文字，点击工具栏的「• 无序」按钮。导出为 NGA BBCode 时会自动转换为 [list]...[/list]。' },
      { title: '3. 清除列表', description: '如果想把列表恢复为普通段落，选中列表项后再次点击对应的「有序」或「无序」按钮即可取消列表格式。' },
      { title: '4. 引用块', description: '选中文字后点击工具栏的「❝ 引用」按钮，选中内容会被包装为灰色背景的引用块。导出为 NGA BBCode 时会自动转换为 [quote]...[/quote]。再次点击该按钮可取消引用格式。' },
    ],
  },
  {
    id: 'collapsible',
    icon: '🧱',
    title: '折叠与代码块',
    summary: '插入折叠块、编辑标题、选中内容折叠、多行代码块',
    steps: [
      { title: '1. 插入折叠块', description: '将光标放在要插入折叠块的位置，点击工具栏的「🔽 折叠」按钮，会插入一个带标题的可折叠块。默认标题为「折叠块」，可以直接点击标题文字进行编辑。' },
      { title: '2. 编辑折叠标题', description: '折叠块的标题文字是可编辑的。直接点击标题区域（非左侧的 +/− 图标）即可修改文字。修改会自动同步，导出时以标题文本为准。' },
      { title: '3. 选中内容折叠', description: '先在编辑器中用鼠标选中一段文字内容，然后点击工具栏的「🔽 折叠」按钮。选中的内容会被自动包装成一个折叠块，而不是在光标位置插入空白折叠块。' },
      { title: '4. 拖动折叠块', description: '折叠块是可拖动的原子块。按住折叠块拖动可以像图片一样把整个折叠块移动到其他位置。' },
      { title: '5. 多行代码块', description: '选中多行文字（例如脚本或数据列表），点击工具栏的「&lt; &gt; 代码」按钮。选中的多行内容会被包装在一个保留换行的代码块中，不会被压缩成一行。导出为 NGA BBCode 时自动转换为 [code]...[/code]。' },
    ],
  },
  {
    id: 'worldbuilding',
    icon: '🌐',
    title: '世界观与模板',
    summary: '世界观设定、模板库管理',
    steps: [
      { title: '1. 世界观设定', description: '在编辑页面中，可以添加世界观设定条目（如魔法体系、地理环境、社会制度等）。每个条目有标题和内容，方便在创作时查阅参考。' },
      { title: '2. 模板库', description: '在首页点击「模板库」进入模板管理页面。模板分为两类：世界观模板和人物模板。模板独立于具体作品，可以被任意作品引用。' },
      { title: '3. 创建自定义模板', description: '在模板库页面中，点击「+ 新建」按钮创建新的世界观或人物模板。编辑模板的内容、属性等信息后保存，之后在任何作品中都可以导入使用。' },
    ],
  },
  {
    id: 'tables',
    icon: '📊',
    title: '表格',
    summary: '插入表格、编辑单元格',
    steps: [
      { title: '1. 插入表格', description: '点击工具栏的「📊 表格」按钮，在弹出的面板中设置行数和列数，点击确定后在光标位置插入空白表格。' },
      { title: '2. 编辑单元格', description: '直接点击任意单元格即可输入或编辑内容。表格单元格支持普通文本。' },
      { title: '3. 导出到 NGA', description: '整个表格会被转换为 NGA BBCode 的 [table] 格式，每个单元格对应 [td] 标签，每一行对应 [tr] 标签。' },
    ],
  },
  {
    id: 'links',
    icon: '🔗',
    title: '链接与分割线',
    summary: '插入超链接、水平分割线',
    steps: [
      { title: '1. 插入超链接', description: '先在编辑器中选中要作为链接显示的文字，点击工具栏的「🔗 链接」按钮。在弹出的输入框中粘贴完整的 URL，点击确定后选中文字会变成可点击的超链接。' },
      { title: '2. 在应用内打开链接', description: '点击编辑器中的超链接会在系统默认浏览器中打开目标网址。导出为 NGA BBCode 时会自动转换为 [url=...]文字[/url] 格式。' },
      { title: '3. 插入分割线', description: '将光标放在要插入分割线的位置，点击工具栏的「— 分割线」按钮，会插入一条水平分割线。' },
    ],
  },
  {
    id: 'export',
    icon: '📤',
    title: '导出为 NGA 格式',
    summary: '导出当前节 BBCode、复制到剪贴板',
    steps: [
      { title: '1. 打开导出对话框', description: '在编辑页面右上角找到「📤 导出」按钮，点击打开导出面板。' },
      { title: '2. 导出当前节', description: '导出面板会显示当前正在编辑的节的内容，自动转换为 NGA 论坛兼容的 BBCode 格式。图片会变为 [img] 标签，列表变为 [list] 标签，折叠块变为 [collapse] 标签，骰子按类型输出，代码块变为 [code] 标签等。' },
      { title: '3. 复制到剪贴板', description: '点击「复制本节」按钮，完整 BBCode 会被复制到系统剪贴板，直接粘贴到 NGA 论坛即可。也可以点击「保存为 .txt」将 BBCode 保存为文本文件。' },
    ],
  },
  {
    id: 'drag-tips',
    icon: '✏️',
    title: '拖动与排版技巧',
    summary: '选中原子块、像文本一样拖动、调整位置',
    steps: [
      { title: '1. 图片、骰子、折叠都是原子块', description: '编辑器中的图片、骰子卡片、折叠块、代码块等都是独立的「原子块」。它们在文本中表现为可移动的独立单位，类似一个大号字符。' },
      { title: '2. 拖动原子块', description: '鼠标点击并按住一个原子块（例如图片），然后将其拖到其他位置释放即可。原子块像文本一样支持在段落内前后移动，也可以移动到段落之间。' },
      { title: '3. 删除原子块', description: '选中图片/骰子/折叠/代码块后按 Delete 或 Backspace 键可以删除。对于折叠块，建议先展开查看内容再决定是否删除，防止误删重要信息。' },
    ],
  },
  {
    id: 'anjia-collector',
    icon: '📜',
    title: '收集安价（从 NGA 抓取）',
    summary: '抓取 NGA 主题帖中"以指定文本开头"的楼层',
    steps: [
      { title: '1. 进入收集安价页面', description: '在首页找到「📜 收集安价」入口，点击进入。可以从 NGA 主题帖中快速抓取多个匹配楼层。' },
      { title: '2. 输入 NGA 链接与楼层范围', description: '粘贴 NGA 主题帖链接（必须包含 <code>tid=XXX</code> 参数），填写起始楼层与末尾楼层。可以点击 URL 旁的「🔍 自动检测」按钮，让应用自动获取主题帖的总页数。' },
      { title: '3. 设置匹配文本（可留空）', description: '匹配文本用于过滤出"以该文本开头"的楼层。如果留空，则抓取起始楼到末尾楼的所有内容（适合全量收集）。需要登录态时，在「设置」中粘贴 NGA Cookie 即可访问受限内容。' },
      { title: '4. 抓取中可取消', description: '点击「开始收集」后，进度条会显示抓取进度。若需要中途停止，点击「取消」即可立即停止并返回已抓取的部分结果。' },
      { title: '5. 管理抓取结果', description: '结果列表中每条都支持：<br>• <b>📋 复制</b>：复制单条内容<br>• <b>🗑 删除</b>：删除单条（删除后可点击 toast 中的「撤销」复原）<br>• <b>📋 复制全部</b>：复制全部楼层为纯文本<br>• <b>📋 复制 NGA 格式</b>：复制为 NGA BBCode 格式（标题加粗，可直接贴到 NGA 编辑器）' },
      { title: '6. 保存与加载历史', description: '抓取成功后，点击「💾 保存到历史」将本次抓取存到本地（最多 10 条）。下次需要时，点击顶栏「📂 历史」下拉，选择对应历史即可一键恢复（链接、范围、结果全部还原）。' },
      { title: '7. 注意事项', description: '• 重新爬取会清空当前列表的删除撤销栈（不可"穿越"撤销）<br>• 单次范围建议不超过 200 楼，超出可能触发 NGA 限流<br>• 抓取历史存在浏览器 localStorage，单条 items 自动截断到 100 条' },
    ],
  },
  {
    id: 'image-store-mode',
    icon: '☁️',
    title: '图片存储模式',
    summary: '选择远端图床或本地保存',
    steps: [
      { title: '1. 打开设置', description: '在顶栏右侧点击「⚙ 设置」按钮，弹出设置对话框。' },
      { title: '2. 选择存储模式', description: '<b>远端图床（默认）</b>：上传到 catbox.moe / sm.ms / 0x0.st / telegra.ph，自动回退到下一个图床。<br><b>本地保存</b>：图片保存到应用数据目录的 <code>images/</code> 文件夹，使用 <code>local://</code> 协议访问。' },
      { title: '3. 上传进度窗口', description: '无论哪种模式，批量上传时都会弹出居中的进度窗口，显示每张图片的上传进度、目标图床、状态等信息。上传过程中可按 ESC 关闭。' },
      { title: '4. NGA 导出兼容', description: '导出为 NGA BBCode 时：<br>• 远端图床：直接使用图床 URL<br>• 本地保存：替换为占位文字 <code>[本地图片：name（已用占位符替换）]</code><br>• base64 兜底方案已禁用（确保图片一定可访问）' },
      { title: '5. 注意事项', description: '• 本地模式仅支持 Electron 应用<br>• <code>local://</code> 协议有路径遍历保护，禁止访问敏感文件<br>• 设置会持久化到 localStorage，下次启动自动恢复' },
    ],
  },
  {
    id: 'backup',
    icon: '💾',
    title: '数据备份与迁移',
    summary: '导出作品、导入还原、批量差分上传',
    steps: [
      { title: '1. 导出作品数据', description: '在「我的作品」列表中，点击作品卡片上的菜单按钮，选择「导出」。系统会将该作品的完整数据（包括章节正文、世界观设定、人物角色及差分、大纲等）打包为一个 <code>.anke.json</code> 文件下载到本地。' },
      { title: '2. 导入作品数据', description: '在「我的作品」页面顶部，点击「📥 导入作品」按钮，选择之前导出的 <code>.anke.json</code> 文件。系统会自动创建一个新作品并还原所有数据，包括章节结构、正文内容、人物差分和世界观设定等。导入的作品标题会自动添加「(导入)」后缀。' },
      { title: '3. 批量上传差分', description: '在人物角色编辑面板中，差分管理区域新增了「📂 批量上传」按钮。点击后可一次选择多张图片（最多 50 张），系统会自动以文件名作为差分名称批量创建。适合一次性导入大量表情差分或服装变体。' },
      { title: '4. 数据存储位置', description: '所有创作数据自动保存在应用数据目录下的 <code>AnkeCreatorData</code> 文件夹中（Windows 路径：<code>%APPDATA%/AnkeCreator/AnkeCreatorData</code>）。每个数据表对应一个 JSON 文件，采用原子写入确保数据安全。如需整体备份，可直接复制该文件夹。' },
    ],
  },
];

export function TutorialPage({ onBack, onShowAuthor }: TutorialPageProps) {
  const [expandedId, setExpandedId] = useState<string | null>('basics');

  return (
    <div
      className="h-full w-full flex flex-col items-center overflow-y-auto"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div className="w-full max-w-3xl px-6 py-8">
        {/* 顶部导航 */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            ← 返回首页
          </button>
          <h1 className="text-2xl font-bold">📘 安科创作教程</h1>
          {onShowAuthor && (
            <button
              onClick={onShowAuthor}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium transition-all ml-auto"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
            >
              ℹ️ 关于作者
            </button>
          )}
        </div>

        {/* 说明条 */}
        <div
          className="px-5 py-4 mb-6 rounded-2xl"
          style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)', color: 'var(--text-primary)' }}
        >
          <div className="text-sm font-semibold mb-1" style={{ color: 'var(--accent)' }}>快速上手</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            点击下方任意主题卡片展开详细步骤指南，共 12 个主题，涵盖从创建作品到导出 NGA BBCode 的完整创作流程。
          </div>
        </div>

        {/* 教程卡片网格 */}
        <div className="space-y-3">
          {TUTORIAL_TOPICS.map((topic) => {
            const isExpanded = expandedId === topic.id;
            return (
              <div
                key={topic.id}
                className="rounded-2xl overflow-hidden"
                style={{
                  background: 'var(--bg-card)',
                  border: `1px solid ${isExpanded ? 'var(--accent)' : 'var(--border-color)'}`,
                  boxShadow: isExpanded ? '0 4px 16px -4px rgba(0,0,0,0.15)' : 'none',
                }}
              >
                {/* 卡片头部（可点击展开/收起） */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : topic.id)}
                  className="w-full px-5 py-4 flex items-center gap-3 transition-colors"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span className="text-xl">{topic.icon}</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {topic.title}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {topic.summary}
                    </div>
                  </div>
                  <span
                    className="text-sm font-bold transition-transform"
                    style={{
                      color: isExpanded ? 'var(--accent)' : 'var(--text-secondary)',
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      display: 'inline-block',
                    }}
                  >
                    ▼
                  </span>
                </button>

                {/* 展开内容（步骤列表） */}
                {isExpanded && (
                  <div
                    className="px-5 pb-5"
                    style={{ borderTop: '1px solid var(--border-color)' }}
                  >
                    <div className="pt-4 space-y-2">
                      {topic.steps.map((step, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl flex gap-3"
                          style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}
                        >
                          <div
                            className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                          >
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold mb-1" style={{ color: 'var(--accent)' }}>
                              {step.title.replace(/^\d+\.\s*/, '')}
                            </div>
                            <div
                              className="text-xs leading-relaxed"
                              style={{ color: 'var(--text-primary)' }}
                              dangerouslySetInnerHTML={{ __html: step.description }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 底部提示 */}
        <div className="mt-8 text-center">
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            💡 提示：所有创作内容保存在本地数据目录，关闭应用后不会丢失。
          </div>
        </div>
      </div>
    </div>
  );
}
