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
    id: 'style-presets',
    icon: '🎨',
    title: '样式预设',
    summary: 'Word 风格样式库：内置预设、自定义保存、光标延续',
    steps: [
      { title: '1. 入口位置', description: '在编辑器工具栏第一行最左侧，点击「样式 ▾」按钮即可展开样式预设下拉面板。' },
      { title: '2. 八种内置预设', description: '内置预设不可删除，覆盖常见写作场景：<br>• <b>正文</b>：宋体 12pt 黑色<br>• <b>标题1/2/3</b>：黑体 18/16/14pt 加粗<br>• <b>强调</b>：14pt 红色加粗<br>• <b>引用</b>：仿宋 12pt 灰色斜体<br>• <b>旁白</b>：楷体 12pt 灰色<br>• <b>心理</b>：微软雅黑 12pt 蓝色斜体' },
      { title: '3. 两种应用模式', description: '<b>有选区</b>：选中一段文字后点击预设，选区文本立即应用该样式（颜色/字号/字体/粗斜体等）。<br><b>无选区（光标处）</b>：不选中任何文字直接点击预设，光标位置会"锁定"该样式，之后输入的新文字自动延续此样式，直到再次点击预设或切换其他样式。' },
      { title: '4. 保存自定义预设', description: '先在编辑器中设置好想要的样式（颜色、字号、字体、粗体/斜体/下划线等），然后打开「样式 ▾」面板，点击底部的「💾 保存当前为预设」按钮，输入名称后即可保存为自定义预设。自定义预设会出现在内置预设下方，刷新页面后仍然存在（自动保存到本地）。' },
      { title: '5. 删除自定义预设', description: '在「样式 ▾」面板中，自定义预设右侧有「✕」删除按钮，点击后确认即可删除。内置预设不可删除，没有删除按钮。' },
    ],
  },
  {
    id: 'images',
    icon: '🖼️',
    title: '图片与存储模式',
    summary: '插入图片、人物差分、图床/本地存储切换',
    steps: [
      { title: '1. 插入图片', description: '点击工具栏的「🖼️ 图片」按钮，选择方式有两种：① 本地上传（从电脑选择图片文件）；② URL 粘贴（粘贴图片链接后点击确定）。图片会以原子块的形式插入到光标位置。' },
      { title: '2. 添加人物与差分图', description: '在左侧「👤 人物角色」视图中点击「+ 新建角色」创建人物。进入人物编辑详情的「差分图」区域，点击「添加图片」上传差分（如开心、生气等不同表情）。每个差分可设置备注，旁边有「插入」按钮可把差分图插入到当前光标位置。' },
      { title: '3. 从模板库导入人物', description: '在左侧人物面板中点击「📋 导入」按钮，会显示所有可用的人物模板。点击任意模板即可直接导入到当前作品中（自动重命名避免冲突）。模板可以在首页「模板库」中预先编辑。' },
      { title: '4. 选择图片存储模式', description: '在顶栏「⚙ 设置」中可选择：<b>远端图床（默认）</b>自动依次尝试 catbox.moe / sm.ms / 0x0.st / telegra.ph，失败自动回退到下一个；<b>本地保存</b>保存到 <code>&lt;安装路径&gt;/data/images/</code> 文件夹，使用 <code>local://</code> 协议访问。批量上传时会弹出进度窗口，可按 ESC 关闭。' },
      { title: '5. NGA 导出兼容与注意事项', description: '导出 NGA BBCode 时：远端图床直接用 URL；本地保存的图片以 <code>local:///子目录/文件名.png</code> 形式写入 BBCode（不会转 base64），重新导入到本应用时可还原。两种模式互不影响，按需切换。注意：本地模式仅支持 Electron 应用；<code>local://</code> 协议有路径遍历保护；设置会持久化到 localStorage。' },
    ],
  },
  {
    id: 'lists',
    icon: '📋',
    title: '列表与折叠块',
    summary: '有序/无序列表、引用块、折叠块、代码块',
    steps: [
      { title: '1. 有序/无序列表', description: '选中多行文字后点击工具栏的「1. 有序」或「• 无序」按钮，选中内容会被包装成列表。导出 NGA BBCode 时自动转换为 [list=1]...[/list] 或 [list]...[/list]。再次点击对应按钮可取消列表格式。' },
      { title: '2. 引用块', description: '选中文字后点击工具栏的「❝ 引用」按钮，选中内容会被包装为灰色背景的引用块。导出为 NGA BBCode 时自动转换为 [quote]...[/quote]。再次点击可取消引用格式。' },
      { title: '3. 插入折叠块', description: '点击工具栏的「🔽 折叠」按钮插入带标题的可折叠块（默认标题「折叠块」，可直接点击编辑）。也可先选中文字再点击「折叠」按钮，选中的内容会被包装成折叠块。折叠块标题栏右侧的 <code>⠿</code> 拖动把手用于拖动整个折叠块（拖动把手以外的区域不会触发移动，避免误操作），块体内可正常选中文本；阅读模式下拖动把手自动隐藏。' },
      { title: '4. 多行代码块', description: '选中多行文字（如脚本或数据列表），点击工具栏的「&lt; &gt; 代码」按钮。选中的多行内容会被包装在保留换行的代码块中。导出为 NGA BBCode 时自动转换为 [code]...[/code]。' },
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
    title: '链接与排版技巧',
    summary: '超链接、分割线、原子块拖动',
    steps: [
      { title: '1. 插入超链接', description: '先在编辑器中选中要作为链接显示的文字，点击工具栏的「🔗 链接」按钮。在弹出的输入框中粘贴完整的 URL，点击确定后选中文字会变成可点击的超链接。点击超链接会在系统默认浏览器中打开。导出 NGA BBCode 时自动转换为 [url=...]文字[/url]。' },
      { title: '2. 插入分割线', description: '将光标放在要插入分割线的位置，点击工具栏的「— 分割线」按钮，会插入一条水平分割线。' },
      { title: '3. 原子块概念', description: '编辑器中的图片、骰子卡片、折叠块、代码块等都是独立的「原子块」。它们在文本中表现为可移动的独立单位，类似一个大号字符。' },
      { title: '4. 拖动与删除原子块', description: '鼠标点击并按住一个原子块（例如图片），然后拖到其他位置释放即可移动。原子块支持在段落内前后移动，也可移动到段落之间。选中原子块后按 Delete 或 Backspace 键可删除。折叠块建议先展开查看内容再删除，防止误删。' },
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
    id: 'export',
    icon: '📤',
    title: '导出（NGA/EPUB）',
    summary: '导出为 NGA BBCode 或 EPUB 电子书',
    steps: [
      { title: '1. 切换到 BBCode 编辑视图', description: '在编辑页面底部点击「📝 BBcode编辑」按钮，主区域会显示当前节的 NGA 兼容 BBCode 文本。' },
      { title: '2. 复制到 NGA 论坛', description: '在 BBCode 视图里按 Ctrl+A 全选、Ctrl+C 复制，然后直接粘贴到 NGA 论坛编辑器。图片自动是 [img] 标签，列表是 [list]，折叠块是 [collapse]，骰子按类型输出，代码块是 [code] 等。' },
      { title: '3. 粘贴 NGA BBCode 反向导入', description: '反过来，从 NGA 论坛复制一段 BBCode，切换到 BBCode 编辑视图后 Ctrl+V 粘贴。编辑停止 300ms 后切回「🎨 可视化编辑」视图即可看到带样式的渲染效果。' },
      { title: '4. 导出为 EPUB 电子书', description: '在「我的作品」页面点击作品卡片菜单（⋮）选择「导出为 EPUB 电子书」。选择保存路径后开始导出，过程包含扫描图片 → 下载图片 → 构建 HTML → 打包 EPUB 等阶段。图片会离线嵌入 EPUB 文件内部。' },
      { title: '5. EPUB 特殊块处理与阅读设备', description: '骰子卡片导出为静态文本（保留结果）；折叠块转换为 <code>&lt;details&gt;</code> 标签可折叠展开；内联 JS 自动移除。导出的 EPUB 可在 Apple Books、Calibre、KOReader、安卓阅读器、Kindle（需转换）等设备上阅读。' },
    ],
  },
  {
    id: 'collectors',
    icon: '📖',
    title: '收集安科（NGA/骨碌碌）',
    summary: '从 NGA 或骨碌碌抓取楼层并导出为安科作品',
    steps: [
      { title: '1. 进入收集页面', description: '首页点击「📜 收集安价/安科」进入 NGA 收集页面，或点击「📖 收集安科」进入统一收集页面。统一收集页面顶部有两个 Tab：「📖 NGA 安科」和「📕 骨碌碌安科」，可互相切换。' },
      { title: '2. NGA 收集安价', description: '粘贴 NGA 主题帖链接（含 <code>tid=XXX</code>），填写楼层范围，可设置匹配文本过滤"以该文本开头"的楼层（留空则全量收集）。点击「🔍 自动检测」可获取总页数。需要登录态时在「设置」中粘贴 NGA Cookie。' },
      { title: '3. NGA 收集安科', description: '顶部 Tab 切换到「📖 NGA 安科」，填写 NGA 帖子 URL、楼层范围、每 N 楼一节（默认 10）。可选填作品标题（留空回退为「安科-{tid}」）和「只看作者」URL（含 <code>authorid=XXX</code>）。点击「📥 确认收集」后程序爬取 → BBCode 转 HTML → 分节 → 拼成 <code>anke-creator-export</code> JSON → 保存对话框。' },
      { title: '4. 骨碌碌收集安科', description: '在统一收集页面顶部点击「📕 骨碌碌安科」Tab 切换到骨碌碌面板。粘贴骨碌碌作品链接（格式 <code>https://www.gululu.world/book/1285</code>），填写楼层范围与分节粒度，点击「🔍 自动检测」可获取作品总楼数。骨碌碌楼层无独立作者，标题用"—— 第 X 节 ——"格式。启用「高级格式设置」可自定义卷/章/节结构，与 NGA 收集方式一致。' },
      { title: '5. 抓取中可取消与失败重试', description: '点击「开始收集」后进度条显示抓取进度，可点击「取消」中途停止并返回已抓取部分。抓取失败的楼层会显示在「失败楼层」区域，可点击「重试失败楼层」单独重新抓取。' },
      { title: '6. 导入到「我的作品」', description: '收集完成后会保存 <code>.anke.json</code> 文件。在「我的作品」页面点击「📥 导入作品」按钮选择该文件即可还原为安科作品，每节对应一个章节小节，可直接在编辑器中查看和修改。' },
      { title: '7. 注意事项', description: '• 单次范围建议不超过 200 楼，超出可能触发限流<br>• NGA 需要有效 Cookie，骨碌碌无需登录<br>• 每节内容包含楼号小标题、正文、楼间虚线分隔<br>• 导入后的作品分类为「安科」，可在作品列表中重命名' },
    ],
  },
  {
    id: 'find-anke',
    icon: '🔍',
    title: '寻找安科作品',
    summary: '从骨碌碌网站和 NGA 安科版块发现想读的安科',
    steps: [
      { title: '1. 进入寻找安科页面', description: '首页点击「🔍 寻找安科」入口。该功能提供两个来源：骨碌碌（gululu.world）和 NGA 安科版块（fid=784）。进入后不会自动搜索，需主动输入关键词后点击搜索按钮。' },
      { title: '2. 输入关键字搜索', description: '在搜索框输入作品名或作者关键字（如「mygo」「跑团」），点击搜索。骨碌碌支持三种匹配模式：「全部」同时搜索作品和作者；「标题」仅匹配作品标题；「作者」仅匹配作者名。NGA 同样支持标题/作者两种模式。系统会调用主进程爬虫真实抓取两个站点的列表，匹配关键字的作品会展示在结果列表。' },
      { title: '3. 本地筛选与排序', description: '搜索完成后，可以通过顶部筛选条对结果进行二次过滤和排序（如按字数、回复数、更新时间等）。修改筛选条件不会触发重新爬取，仅在本地结果集中过滤。' },
      { title: '4. 打开作品原文', description: '点击结果条目可复制链接或在新窗口打开原文。骨碌碌作品链接格式为 <code>gululu.world/book/{id}</code>（如 <code>gululu.world/book/62149</code>），NGA 帖子链接格式为 <code>ngabbs.com/read.php?tid={tid}</code>（如 <code>ngabbs.com/read.php?tid=47092312</code>）。' },
      { title: '5. 注意事项', description: '• 该功能仅桌面版可用（安卓版会显示不支持提示）<br>• 进入页面不会自动搜索，需主动输入关键词<br>• 关键字未变时不会重新爬取，仅本地筛选，可避免重复请求<br>• NGA 站点需要有效的登录 Cookie 才能搜索（未配置时会提示 ERROR:2048 登录限制），请在「设置 → NGA 登录态」中粘贴 Cookie 后重试<br>• 骨碌碌无需登录即可搜索' },
    ],
  },
  {
    id: 'dice',
    icon: '🎲',
    title: '骰子功能',
    summary: '骰子历史面板、QuickDicePanel、DicePlayground',
    steps: [
      { title: '1. 骰子历史面板', description: '在编辑页面右侧面板切换到「🎲骰点」tab，下方即为骰子历史记录区。所有在编辑器中投掷的骰子都会自动记录到此。面板仅显示当前打开作品的记录，作品导入导出时骰子历史一并携带。' },
      { title: '2. 历史搜索与分组', description: '顶部搜索框支持按骰子名称、类型、结果、所属小节标题进行大小写不敏感搜索。分组按钮可切换三种模式：「平铺」按时间倒序展示；「按时间」分为今天/昨天/本周/更早；「按作品」跨作品分组可折叠展开。每条记录可单条删除，点击记录可跳转到对应骰子卡片。' },
      { title: '3. QuickDicePanel 表达式骰子', description: '在右侧面板切换到「⚙️属性」tab，顶部为 QuickDicePanel。输入表达式（如 <code>1d100</code>、<code>2d50+10</code>、<code>3d6</code>）后点击「投骰」或按回车，骰子会播放旋转动画和音效。点击「复制」可复制 NGA 风格文本 <code>[表达式=结果]</code>。仅用于快速投骰，不插入卡片到正文，也不记录到历史。' },
      { title: '4. DicePlayground 玩骰子', description: '在首页或编辑器中找到「🎲 玩骰子」入口进入独立界面。选择骰子类型（数值/选项），设置面数、数量、修饰符或选项内容后点击投骰。骰子播放旋转动画和音效，结果显示总点数和详细分解。适合写作时临时掷骰做决策，不影响正文内容，也不记录到历史。' },
      { title: '5. 自定义骰子音效', description: '在「⚙ 设置 → 骰子音效」区域，可以上传自己的 mp3 文件（最多若干个，可删除）。旋转动画时会从已上传的音效中随机选一个播放，骰子落地也有对应音效。设置会持久化到本地，删除应用不会丢失。' },
      { title: '6. 骰子配置对话框样式设置', description: '在骰子配置对话框中，可以为「未选项 / 已选项 / 结果文字」分别设置颜色、字体、字号（20-500% 滑块），支持 NGA 24 色调色板和 NGA 16 字体列表。暗色模式下黑色会自动反转为白色。导出 NGA BBCode 时自动嵌套 <code>[color]</code> <code>[size]</code> <code>[font]</code> <code>[b]</code> <code>[i]</code> <code>[u]</code> <code>[del]</code> 标签。' },
    ],
  },
  {
    id: 'data-management',
    icon: '💾',
    title: '数据管理与安卓端',
    summary: '备份迁移、卸载清理、安卓端编辑优化',
    steps: [
      { title: '1. 导出/导入作品数据', description: '在「我的作品」列表点击作品卡片菜单选择「导出」，系统会将该作品完整数据（章节正文、世界观、人物差分、大纲等）打包为 <code>.anke.json</code> 文件。点击「📥 导入作品」选择该文件即可还原为新作品（标题自动添加「(导入)」后缀）。' },
      { title: '2. 批量上传差分与数据存储位置', description: '人物角色编辑面板的差分管理区域有「📂 批量上传」按钮，可一次选择多张图片（最多 50 张），系统自动以文件名作为差分名称批量创建。所有数据保存在 <code>&lt;安装路径&gt;/data/</code>（桌面端）或 app 私有目录（安卓端），其中 <code>images/</code> 存放本地图片，<code>*.json</code> 是各表数据，可直接复制整个 <code>data/</code> 文件夹整体备份。' },
      { title: '3. 卸载时的数据询问', description: 'Windows 卸载时会询问「是否同时删除所有个人数据？」。选「是」彻底清理 <code>&lt;安装路径&gt;/data/</code>，重装数据全空；选「否」保留数据，重装自动恢复（重装后会提示选择旧数据目录）。Android 卸载时系统自动清空 app 私有目录（已禁用云备份）。也可在「⚙ 设置 → 数据管理」中主动清空。' },
      { title: '4. 暗色 / 亮色模式', description: '在「⚙ 设置」中切换主题：亮色 / 暗色 / 跟随系统。切换后立即生效，所有页面同步刷新。字色色块在暗色模式下黑色自动反转为白色（保证可读性）。主题选择持久化到本地。' },
      { title: '5. 安卓端智能折叠与全屏', description: '安卓端弹出键盘后系统会自动隐藏底部导航条等非必要元素，并折叠面包屑、底状态条等次要控件。点击顶部工具栏的「⤢」全屏按钮可进入「全屏专注编辑模式」，编辑器铺满整个屏幕，所有其他 UI 隐藏。再次点击「⤢」或按返回键退出。' },
      { title: '6. 安卓端键盘行为与注意', description: '安卓端配置 <code>windowSoftInputMode=adjustResize</code>，键盘弹出时网页被压缩而不是被覆盖，编辑区域始终可见。全屏模式下编辑停止 800ms 后自动保存。安卓端不支持部分桌面端功能（如 EPUB 导出、寻找安科、玩转盘等），相关入口会显示「仅桌面版可用」提示。' },
    ],
  },
  {
    id: 'keyboard-shortcuts',
    icon: '⌨️',
    title: '键盘快捷键',
    summary: '常用编辑操作的全局快捷键',
    steps: [
      { title: '1. 编辑器快捷键', description: '在编辑器中可使用以下快捷键快速插入原子块：<br>• <b>Ctrl+Shift+Q</b>：引用块（<code>❝ 引用</code>）<br>• <b>Ctrl+Shift+C</b>：折叠块（<code>🔽 折叠</code>）<br>• <b>Ctrl+Shift+D</b>：插入骰子（<code>🎲 骰子</code>）<br>• <b>Ctrl+Shift+S</b>：删除线（<code>̶S̶ 删除线</code>）' },
      { title: '2. 工具栏提示', description: '鼠标悬停在工具栏按钮上 1 秒左右，弹出的 tooltip 会显示该按钮对应的快捷键（如「Ctrl+Shift+D」），方便不熟悉快捷键的用户随时查看。' },
      { title: '3. 与系统快捷键的关系', description: '这些快捷键都带 Ctrl+Shift 修饰，避免和系统 / 浏览器 / 富文本原生快捷键（如 Ctrl+B 加粗、Ctrl+C 复制）冲突。在文本输入框 / 引用块 / 折叠块内均生效。' },
    ],
  },
  {
    id: 'wheel',
    icon: '🎡',
    title: '玩转盘',
    summary: '多阶段抽签 + 变量 / 条件 / 公式 + 导入导出 + 100 条历史',
    steps: [
      { title: '1. 入口位置', description: '首页有「🎡 玩转盘」入口，点击进入独立的转盘页面。数据保存在 <code>&lt;安装路径&gt;/data/wheels.json</code>，不影响其他作品数据。' },
      { title: '2. 创建方案', description: '在「方案」Tab 点击「+ 新建方案」创建转盘。一个方案由多个阶段组成，每个阶段可设置候选项及其权重、修饰符。命名方案后保存到本地。支持复制方案、删除方案、按名称搜索。' },
      { title: '3. 抽取与多阶段', description: '在「抽取」Tab 选择方案，依次点击每阶段右侧的「🎯 抽取」按钮。旋转动画结束后展示该阶段结果。如有下一阶段会自动启用，可继续抽取。所有阶段完成后显示「最终结果」（每个阶段的命中项 + 总览）。' },
      { title: '4. 变量、条件与公式', description: '方案支持高级模式：定义变量（数字 / 字符串 / 选项），用条件控制是否启用某些候选项，命中后用公式更新变量（如 <code>score = score + 1d20</code>、<code>2*3d100</code>、<code>1d10+2d50</code>），下次抽取时变量值参与计算。适合复杂决策树 / 角色生成。' },
      { title: '5. 导入与导出', description: '方案可单独导出为 <code>.wheel.json</code> 文件（含变量、条件、公式），也可在导出对话框中选择「打包多个方案」生成 zip。导入时选择对应文件即可还原到本地。可用于跨设备共享方案。' },
      { title: '6. 历史记录', description: '每次抽取结果保存到历史记录（最多 100 条 FIFO，超出自动淘汰最旧）。历史条目可点击展开查看每个阶段结果与变量终值，可一键「复用结果」再次抽取（带相同变量值）。' },
    ],
  },
  {
    id: 'section-parser',
    icon: '📋',
    title: '文本解析小节结构',
    summary: '从纯文本快速生成章节小节（用于 NGA / 骨碌碌收集）',
    steps: [
      { title: '1. 入口位置', description: '在 NGA / 骨碌碌收集页打开「高级格式设置」面板，每个章节卡片标题旁有「📋 解析文本」按钮（与「+ 添加小节」并排）。点击后弹出文本输入对话框。' },
      { title: '2. 输入格式', description: '每行一个区间，支持以下写法：<br>• 单独楼层：<code>10</code> 或 <code>第10楼</code><br>• 区间：<code>10-20</code>、<code>10到20</code>、<code>第10到第20楼</code><br>• 多个区间一行：<code>1-5, 8, 12-15</code>（生成多个 section）<br>• 起始省略：<code>-20</code> 自动从上一节结束楼层 +1 开始' },
      { title: '3. 解析与覆盖', description: '点击「解析」后，解析器会按行拆分、容错（自动补全中英文标点差异、忽略空行、跳过注释 <code>#</code> 开头），生成对应数量的 section。<b>注意：解析会替换当前章节下的所有现有小节</b>，解析前可手动备份（导出当前章节）。' },
      { title: '4. 错误提示与重试', description: '若某行无法解析（如楼层数 ≤ 0、起始 > 结束），会显示在错误提示框（红色文字）。修正后再次点击「解析」即可。' },
      { title: '5. 适用场景', description: '从 NGA / 骨碌碌收集的整段帖子快速按楼层拆分到不同小节；导入预制的章节结构模板；批量重排已有小节。' },
    ],
  },
  {
    id: 'resource-library-advanced',
    icon: '🖂️',
    title: '资源库子目录与批量上传',
    summary: '磁盘同步、子目录识别、批量上传、拖动换顺序',
    steps: [
      { title: '1. 整体入口', description: '首页点击「🖼️ 图片」或侧边栏「资源库」进入资源库页。资源库左侧显示子目录树，右侧显示当前目录下的图片网格。' },
      { title: '2. 直接放入 data/images 自动识别', description: '把图片文件夹直接复制到 <code>&lt;安装路径&gt;/data/images/</code> 下（如 <code>data/images/角色名/</code>），下次打开资源库时系统会自动把这些子目录识别为 DB folder，把里面的图片识别为 local item（无需手动「本地上传」）。已存在的同名 folder 会复用，不会重复创建。' },
      { title: '3. 批量上传', description: '在资源库页点击「📷 本地上传」可一次选择多张图片（最多 50 张）批量上传。文件名（含扩展名）作为默认名称，可逐个修改后保存。上传时弹出进度窗口，可按 ESC 取消。' },
      { title: '4. 拖动换顺序与跨目录移动', description: '图片卡片支持鼠标拖动：拖到其他位置可调整当前目录内顺序；拖到左侧子目录项可移动到该子目录；拖到「根目录」区域可移回根。子目录也支持拖动换顺序。' },
      { title: '5. 子目录重命名同步', description: '右键子目录选择「重命名」，输入新名称后，DB folder name 与磁盘文件夹名同步更新，<b>所有子图 URL 也会同步重命名</b>（如 <code>local:///角色A/1.png</code> → <code>local:///新名字/1.png</code>），已插入编辑器的图片仍可正常显示。' },
      { title: '6. URL 上传（外链图片）', description: '点击「🔗 URL 上传」粘贴外链图片 URL，系统下载后入库为 source=url 的图片项（不下载到磁盘，仅记录 URL）。适合临时引用云端图床。' },
    ],
  },
  {
    id: 'image-style',
    icon: '🎨',
    title: '字色色块',
    summary: 'NGA 24 色调色板 + 暗色模式自动反转',
    steps: [
      { title: '1. 入口位置', description: '编辑器工具栏「字号」右侧有一个「🎨 字色」按钮，点击后弹出 24 色调色板面板（按 NGA BBCode 规范取色）。' },
      { title: '2. 三种应用模式', description: '<b>有选区</b>：选中文字后点击色块，选中文本立即应用该颜色；<b>无选区（光标处）</b>：光标位置"锁定"该颜色，新输入文字延续该色；<b>光标在已有彩色文字上</b>：点击色块修改该段颜色（不会清空其他属性）。' },
      { title: '3. 暗色模式反转', description: '应用切换到暗色模式时，<b>黑色色块（#000000）自动反转为白色（#FFFFFF）</b>，避免黑字黑底不可见。其他颜色不变。设置会自动持久化。' },
      { title: '4. 导出 NGA BBCode', description: '应用的颜色自动写入 <code>[color=#xxxxxx]文字[/color]</code>。NGA 不识别的颜色会被四舍五入到 NGA 24 色调色板中最接近的项。' },
    ],
  },
  {
    id: 'bbcode-validation',
    icon: '✅',
    title: 'BBCode 校验与跳转',
    summary: '实时校验 + 行号错误 + 点击跳转',
    steps: [
      { title: '1. 切到 BBCode 视图触发校验', description: '在编辑页底部点击「📝 BBcode编辑」切换到 BBCode 视图，编辑器会实时校验当前节的 BBCode 文本。校验规则包括：必闭合标签（<code>[b] [i] [u] [del] [color] [size] [font] [quote] [code] [list] [collapse]</code> 等）、合法嵌套（<code>[b]</code> 内不能再有 <code>[list]</code>）、白名单过滤（未在白名单的标签会被标记）。' },
      { title: '2. 错误提示框', description: '校验失败的行会在 BBCode 视图顶部错误提示框中显示：每条错误包含<b>行号 + 错误描述 + 出错的标签片段</b>。提示框可展开 / 折叠，最大高度限制（约 200px） + 超出滚动条，避免遮挡 BBCode 编辑区。' },
      { title: '3. 点击错误行跳转', description: '点击错误条目可直接跳转到 BBCode 视图的对应行（自动滚动到可见位置 + 高亮闪烁 1 秒）。如需修复后回可视化视图，切回「🎨 可视化编辑」即可看到应用了修正后的样式。' },
      { title: '4. 普通文本方括号不会被误报', description: '若 BBCode 文本中包含普通方括号文字（如 <code>[这是个例子]</code>），校验器会基于白名单过滤，未在白名单的方括号被识别为普通文本，不会报错。' },
      { title: '5. 反向导入（NGA → 本应用）', description: '从 NGA 论坛复制一段 BBCode 粘贴到 BBCode 视图（Ctrl+V），系统会尝试解析为可视化编辑。如有无法识别的标签，会保留为原始 BBCode 文本并提示「存在未识别标签」。' },
    ],
  },
  {
    id: 'theme',
    icon: '🌙',
    title: '暗色 / 亮色模式',
    summary: '主题切换 + 字色色块自动反转 + 状态持久化',
    steps: [
      { title: '1. 入口位置', description: '在「⚙ 设置」面板的「主题」区域可选择：<b>亮色</b> / <b>暗色</b> / <b>跟随系统</b>。切换后立即生效，所有页面同步刷新，无需重启。' },
      { title: '2. 字色色块自动反转', description: '切到暗色模式后，编辑器字色面板中的<b>黑色色块（#000000）自动反转为白色（#FFFFFF）</b>，避免黑字黑底不可见。其他颜色保持不变。' },
      { title: '3. 主题持久化', description: '主题选择保存到 localStorage（键名 <code>theme-mode</code>），下次启动应用自动恢复。卸载 / 重装不影响（除非同时清空 localStorage）。' },
      { title: '4. 跟随系统', description: '选择「跟随系统」后，应用会监听系统颜色方案变化（Windows / macOS / 安卓），系统切到深色时应用立即切到暗色。' },
    ],
  },
];

export function TutorialPage({ onBack, onShowAuthor }: TutorialPageProps) {
  const [expandedId, setExpandedId] = useState<string | null>('basics');

  return (
    <div
      className="min-h-full w-full flex flex-col items-center"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div className="w-full max-w-3xl px-6 py-8">
        {/* 顶部导航（非 sticky，跟随内容一起滚动） */}
        <div className="flex items-center gap-3 mb-6" style={{ background: 'var(--bg-base)' }}>
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
            点击下方任意主题卡片展开详细步骤指南，共 {TUTORIAL_TOPICS.length} 个主题，涵盖从创建作品到导出 NGA BBCode 的完整创作流程。
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
