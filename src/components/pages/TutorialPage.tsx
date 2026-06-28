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
    summary: '在 BBCode 视图直接复制，或粘贴 NGA BBCode 反向导入',
    steps: [
      { title: '1. 切换到 BBCode 编辑视图', description: '在编辑页面底部点击「📝 BBcode编辑」按钮，主区域会显示当前节的 NGA 兼容 BBCode 文本。' },
      { title: '2. 复制到 NGA 论坛', description: '在 BBCode 视图里按 Ctrl+A 全选、Ctrl+C 复制，然后直接粘贴到 NGA 论坛编辑器。图片自动是 [img] 标签，列表是 [list]，折叠块是 [collapse]，骰子按类型输出，代码块是 [code] 等。' },
      { title: '3. 粘贴 NGA BBCode 反向导入', description: '反过来，从 NGA 论坛复制一段 BBCode，切换到 BBCode 编辑视图后 Ctrl+V 粘贴。编辑停止 300ms 后切回「🎨 可视化编辑」视图即可看到带样式的渲染效果。' },
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
      { title: '1. 进入收集安价页面', description: '在首页找到「📜 收集安价/安科」入口，点击进入。可以从 NGA 主题帖中快速抓取多个匹配楼层。' },
      { title: '2. 输入 NGA 链接与楼层范围', description: '粘贴 NGA 主题帖链接（必须包含 <code>tid=XXX</code> 参数），填写起始楼层与末尾楼层。可以点击 URL 旁的「🔍 自动检测」按钮，让应用自动获取主题帖的总页数。' },
      { title: '3. 设置匹配文本（可留空）', description: '匹配文本用于过滤出"以该文本开头"的楼层。如果留空，则抓取起始楼到末尾楼的所有内容（适合全量收集）。需要登录态时，在「设置」中粘贴 NGA Cookie 即可访问受限内容。' },
      { title: '4. 抓取中可取消', description: '点击「开始收集」后，进度条会显示抓取进度。若需要中途停止，点击「取消」即可立即停止并返回已抓取的部分结果。' },
      { title: '5. 管理抓取结果', description: '结果列表中每条都支持：<br>• <b>📋 复制</b>：复制单条内容<br>• <b>🗑 删除</b>：删除单条（删除后可点击 toast 中的「撤销」复原）<br>• <b>📋 复制全部</b>：复制全部楼层为纯文本<br>• <b>📋 复制 NGA 格式</b>：复制为 NGA BBCode 格式（标题加粗，可直接贴到 NGA 编辑器）' },
      { title: '6. 保存与加载历史', description: '抓取成功后，点击「💾 保存到历史」将本次抓取存到本地（最多 10 条）。下次需要时，点击顶栏「📂 历史」下拉，选择对应历史即可一键恢复（链接、范围、结果全部还原）。' },
      { title: '7. 注意事项', description: '• 重新爬取会清空当前列表的删除撤销栈（不可"穿越"撤销）<br>• 单次范围建议不超过 200 楼，超出可能触发 NGA 限流<br>• 抓取历史存在浏览器 localStorage，单条 items 自动截断到 100 条' },
    ],
  },
  {
    id: 'anke-collector',
    icon: '📖',
    title: '收集安科（从 NGA 抓取整段安科）',
    summary: '把 NGA 帖子里指定范围的楼层抓下来，自动分成节并导出为安科作品',
    steps: [
      { title: '1. 进入收集安科', description: '首页点击「📜 收集安价/安科」进入页面，顶部 Tab 切换到「📖 收集安科」。' },
      { title: '2. 填写 NGA 帖子 URL', description: '粘贴 NGA 主题帖链接（必须包含 <code>tid=XXX</code>），例如 <code>https://nga.178.com/read.php?tid=12345678</code>。' },
      { title: '3. 设置楼层范围与分节粒度', description: '<b>起始楼层</b> / <b>终止楼层</b>：要抓的楼号区间。<br><b>每 N 楼一节</b>：默认 10，程序会按这个粒度把内容切成多个节，方便后续阅读和编辑。' },
      { title: '4. 作品标题（可选）', description: '留空则用「安科-{tid}」作为标题。也可以手动填一个有意义的标题，例如「安科-2026」。' },
      { title: '5. 只看作者（可选）', description: '想只收集某一作者的楼时，粘贴 NGA 上"只看该作者"页面的 URL（含 <code>authorid=XXX</code> 参数）。留空则收集所有人的楼。' },
      { title: '6. 点击「📥 确认收集」', description: '程序会：① 调用主进程爬取 NGA 帖子 ② 把 BBCode 转成对应的 HTML 样式 ③ 每 N 楼一节加小标题"—— N 楼 @作者 ——" + 楼间分隔线 ④ 拼成 <code>anke-creator-export</code> 格式的作品 JSON ⑤ 弹出系统保存对话框（或 Web 端直接下载 <code>.anke.json</code>）。' },
      { title: '7. 在「我的作品」中导入', description: '切到「我的作品」页面，点击「📥 导入作品」按钮，选刚才下载的 <code>.anke.json</code> 即可还原为安科作品，每节对应一个章节小节，可直接在编辑器中查看和修改。' },
      { title: '8. 注意事项', description: '• 一次抓取的范围过大可能触发 NGA 限流，建议不超过 200 楼<br>• 每节内容包含 ① 楼号小标题 ② BBCode 转后的正文 ③ 楼间虚线分隔<br>• 导入后的作品分类为「安科」，可在作品列表中重命名' },
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
  {
    id: 'uninstall',
    icon: '🗑️',
    title: '卸载与数据清理',
    summary: '卸载时询问是否删除个人数据，可在应用内主动清空',
    steps: [
      { title: '1. 卸载时的数据询问（Windows）', description: '运行卸载程序时，会弹出对话框询问「是否同时删除所有个人数据？」（默认按钮 = 「是」）。选「是」会彻底清理 <code>&lt;安装路径&gt;\data\</code> 目录（兜底同时清理 <code>%APPDATA%</code> 下的历史命名数据），下次重装数据全空。选「否」则保留 <code>&lt;安装路径&gt;\data\</code>，下次重装自动恢复。' },
      { title: '2. 卸载行为（Android）', description: 'Android 卸载时系统会自动清空 app 私有目录（<code>/data/data/&lt;package&gt;/</code>），包括 WebView 缓存、IndexedDB、localStorage 和所有用户作品数据。已禁用云备份（<code>allowBackup="false"</code>），避免卸载重装后从云端恢复旧数据。设备转移（换机迁移）时数据仍跟随。' },
      { title: '3. 应用内主动清空', description: '在「⚙ 设置 → 数据管理」中，可点「🗑️ 清空所有本地数据」按钮主动清理（仅 Windows 端，Android 通过系统卸载即可）。此操作会清空所有作品、世界观、人物、图片、NGA 登录 Cookie 等，且不可恢复。点「了解卸载行为」可查看完整说明弹窗。' },
      { title: '4. 卸载前建议', description: '• 重要作品先「导出」为 <code>.anke.json</code> 备份到非系统盘<br>• NGA Cookie 重新登录即可（不影响服务器端）<br>• 主题、模板等个人偏好需重新设置（可考虑同步到 .anke.json 中）' },
    ],
  },
  {
    id: 'find-anke',
    icon: '🔍',
    title: '寻找安科作品',
    summary: '从骨碌碌网站和 NGA 安科版块发现想读的安科',
    steps: [
      { title: '1. 进入寻找安科页面', description: '首页点击「🔍 寻找安科」入口。该功能提供两个来源：骨碌碌（gululu.world）和 NGA 安科版块（fid=784）。' },
      { title: '2. 输入关键字搜索', description: '在搜索框输入作品名或作者关键字，点击搜索。系统会调用主进程爬虫真实抓取两个站点的列表，匹配关键字的作品会展示在结果列表。' },
      { title: '3. 本地筛选与排序', description: '搜索完成后，可以通过顶部筛选条对结果进行二次过滤和排序（如按字数、回复数、更新时间等）。修改筛选条件不会触发重新爬取，仅在本地结果集中过滤。' },
      { title: '4. 打开作品原文', description: '点击结果条目可复制链接或在新窗口打开 NGA 帖子原文。配合「收集安科」功能，可以把找到的 tid 复制过去快速抓取正文。' },
      { title: '5. 注意事项', description: '• 该功能仅桌面版可用（安卓版会显示不支持提示）<br>• 关键字未变时不会重新爬取，仅本地筛选，可避免重复请求<br>• NGA 站点需要 Cookie 才能访问部分帖子，请在设置中配置' },
    ],
  },
  {
    id: 'export-epub',
    icon: '📚',
    title: '导出为 EPUB 电子书',
    summary: '把安科作品导出为可在手机/Kindle 阅读器阅读的 EPUB 文件',
    steps: [
      { title: '1. 入口位置', description: '在「我的作品」页面，点击作品卡片右下角的菜单按钮（⋮），选择「导出为 EPUB 电子书」。' },
      { title: '2. 选择保存位置', description: '点击后会弹出系统保存对话框，选择 EPUB 文件保存路径（默认文件名「作品名.epub」），点击保存开始导出。' },
      { title: '3. 进度展示', description: '导出过程中会显示进度弹窗，包含 6 个阶段：扫描图片 → 下载图片 → 构建 HTML → 打包 EPUB → 完成。每个阶段都会显示当前进度百分比和具体操作描述。' },
      { title: '4. 图片离线处理', description: 'EPUB 中的图片会被下载并嵌入到 EPUB 文件内部（离线可读）。图片来源支持：远端图床 URL、本地 <code>local://</code> 协议、base64 内嵌。下载失败的图片会替换为占位图，不中断导出。' },
      { title: '5. 特殊块处理', description: '• 骰子卡片：导出为静态文本（保留骰子结果）<br>• 折叠块：转换为 EPUB 兼容的 <code>&lt;details&gt;</code> 标签，依然可折叠展开<br>• 内联 JS（如 onerror）：自动移除（EPUB 阅读器不允许 JS）' },
      { title: '6. 阅读设备', description: '导出的 EPUB 文件可在 Apple Books、Calibre、KOReader、各种安卓阅读器（如静读天下、Moon+ Reader）、Kindle（需转换）等设备上阅读。' },
    ],
  },
  {
    id: 'android-edit',
    icon: '📱',
    title: '安卓端编辑优化',
    summary: '键盘弹出时的智能布局调整和全屏专注编辑模式',
    steps: [
      { title: '1. 智能折叠', description: '在安卓端编辑安科时，弹出键盘后系统会自动隐藏底部导航条等非必要元素，并自动折叠面包屑、底状态条、同步按钮行等次要控件，把有限的屏幕空间让给编辑器。' },
      { title: '2. 进入全屏专注编辑', description: '在编辑页面的顶部工具栏找到「⤢」全屏按钮，点击进入「全屏专注编辑模式」。此模式下编辑器会铺满整个屏幕（覆盖系统状态栏），所有其他 UI 都隐藏，适合长段文字创作。' },
      { title: '3. 退出全屏', description: '在全屏模式下，点击右上角的「⤢」按钮（或按返回键）即可退出全屏，返回正常编辑视图。' },
      { title: '4. 键盘弹出行为', description: '安卓端已配置 <code>windowSoftInputMode=adjustResize</code> + <code>interactive-widget=resizes-content</code>，键盘弹出时整个网页会被压缩而不是被覆盖，编辑区域始终可见，光标位置会自动滚动到可视范围。' },
      { title: '5. 注意事项', description: '• 全屏模式下不会自动保存（与正常模式一致，编辑停止 800ms 后自动保存）<br>• 如果使用外接蓝牙键盘，键盘弹出/收起的判定可能略有延迟，属于系统 WebView 行为<br>• 安卓端不支持部分桌面端功能（如 EPUB 导出、寻找安科），相关入口会显示「仅桌面版可用」提示' },
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
            点击下方任意主题卡片展开详细步骤指南，共 17 个主题，涵盖从创建作品到导出 NGA BBCode 的完整创作流程。
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
