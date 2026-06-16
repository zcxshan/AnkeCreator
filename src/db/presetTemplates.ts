// ============================================================
// 预置模板数据
// ------------------------------------------------------------
// 在此文件中填写预置的世界观模板和人物模板。
// 应用首次启动时会自动将这些模板插入数据库。
// 预置模板不可编辑/删除，但导入到作品后的副本可以修改。
// ============================================================

import type { CharacterVariant } from '../types';

export interface PresetWorldTemplateData {
  title: string;
  content: string;
  is_preset: number;
}

/** 人物预置模板完整数据（对应 CharacterTemplate 所有字段） */
export interface PresetCharacterTemplateData {
  name: string;
  avatar: string;
  personality: string;
  attributes: Record<string, string | number>;
  notes: string;
  variants: CharacterVariant[];
  is_preset: number;
}

export function getPresetWorldTemplates(): PresetWorldTemplateData[] {
  return [
    {
      "title": "无限恐怖",
      "content": "世界观源自zhttty创作的网络小说《无限恐怖》及后续系列。核心设定为‘主神空间’：一个由未知高位存在创造的超维空间，通过光球形态的主神向被选中的轮回者发布任务。轮回者需进入各种恐怖电影、游戏、传说构建的独立位面，完成主线与支线任务以获取奖励点数与支线剧情，用以兑换血统、技能、装备、属性强化等。解开‘基因锁’是关键进化路径，共分五阶，每一阶都大幅提升战力并伴随反噬风险。轮回小队间常产生团战，最终目标指向‘最终一战’和‘超脱’。世界观融合了因果律、位面穿梭、圣人遗留、修真与科技等多重元素，后期引入‘无限曙光’、‘无限未来’等分支，拓展了多元宇宙、大千世界、封神榜等概念，形成以‘轮回’为本质的庞大体系。",
      "is_preset": 1
    },
    {
      "title": "龙与地下城",
      "content": "龙与地下城（Dungeons & Dragons）是世界上第一款商业化的桌上角色扮演游戏，拥有数十年积累的宏大世界观。核心架构为‘多元宇宙’，包含三大主要物质位面（如被遗忘的国度、灰鹰、龙枪等），以及外域、印记城、星界、元素位面、诸神国度等无数界域。世界由诸神支配，神祇分为强大神力、中等神力、弱等神力等，依靠信徒的信仰维持力量。魔法基于‘魔网’，施法者通过法术位施展奥术与神术，分为九环等级。智慧种族繁多，如人类、精灵、矮人、半身人、龙裔、卓尔等；职业体系涵盖战士、法师、牧师、游荡者等基础职业及无数进阶职业。标志性生物包括各种彩色龙与金属龙、眼魔、夺心魔、巫妖等。被遗忘的国度是其最著名的世界设定，拥有详细的地理、历史、组织（如竖琴手、散塔林会）与传奇人物（如崔斯特·杜垩登、伊尔明斯特）。世界观强调阵营九宫格（守序善良到混乱邪恶）与冒险史诗，兼具深厚底蕴与持续扩展的生命力。",
      "is_preset": 1
    },
    {
      "title": "魔法禁书目录",
      "content": "出自镰池和马创作的轻小说系列《魔法禁书目录》及其衍生作品。世界分为‘科学侧’与‘魔法侧’，两方表面共存实则暗中对立。科学侧以日本‘学园都市’为代表，拥有领先外界20～30年的科技，通过药物、催眠等手段对学生进行‘超能力开发’，能力者分为Level 0（无能力）至Level 5（超能力者），仅7名Level 5被称作‘最强’。魔法侧以世界三大宗教派系为主，如罗马正教、英国清教、俄罗斯成教，依靠偶像崇拜与魔力发动魔法，存在‘圣人’‘魔神’‘天使’等高阶存在。主角上条当麻的右手拥有‘幻想杀手’，可以消除一切异能之力，但也同时抹消其自身的‘幸运’。故事核心围绕科学与魔法的交织冲突，逐步揭示‘魔神’的真相、异世界相位、人工天界等宏大设定。学园都市内部存在统括理事会与暗部组织，外部则面临各种魔法结社与‘神之右席’的威胁，构成复杂多元且持续拓展的世界观。",
      "is_preset": 1
    }
  ];
}

/** 人物模板 —— 你可以自由增删条目和修改内容 */
export function getPresetCharacterTemplates(): PresetCharacterTemplateData[] {
  return [
    {
      name: '丰川祥子',
      avatar: '',
      personality: '昔日温柔的大小姐，因家庭剧变而变得冷漠决绝。组建Ave Mujica是为“忘记一切”，身兼制作人、作曲、剧本与键盘，以强烈的意志支配整个乐队的世界观。',
      attributes: {},
      notes: 'Ave Mujica键盘手、制作人，艺名“Oblivionis”（忘却）。曾是CRYCHIC的创立者与键盘手。；生日：2月14日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '祐天寺若麦',
      avatar: '',
      personality: '原知名网红“喵梦”，渴望关注与认可。被祥子以“我能给你想要的全部关注”说服加入，性格外向、表现欲强，负责乐队的宣传和视频。',
      attributes: {},
      notes: 'Ave Mujica鼓手，艺名“Amoris”（爱）。负责将Ave Mujica的世界扩散出去。；生日：12月1日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '八幡海铃',
      avatar: '',
      personality: '冷静、理性，拥有专业级贝斯技术，曾作为支援乐手参与多个乐队。对人际关系保持一定距离，但认同祥子的能力与Ave Mujica的理念而正式加入。',
      attributes: {},
      notes: 'Ave Mujica贝斯手，艺名“Timoris”（恐惧）。以技术支撑起乐队的低音。；生日：4月7日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '若叶睦',
      avatar: '',
      personality: '极少主动说话，被祥子形容为“像人偶一样”。自幼与祥子相识，一直默默守护着她，即使被冷落也甘愿成为祥子剧本中的“Mortis”。情感内敛而深沉。',
      attributes: {},
      notes: 'Ave Mujica吉他手，艺名“Mortis”（死亡）。曾是CRYCHIC成员。；生日：1月13日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '三角初华',
      avatar: '',
      personality: '前偶像组合成员，现以“Doloris”名义活动。舞台印象神秘哥特，私下冷静沉着，为达成目标可隐藏真实自我。与丰川祥子有某种约定而组建Ave Mujica。',
      attributes: {},
      notes: 'Ave Mujica主唱。在Ave Mujica的世界观中扮演“悲伤”。；生日：6月26日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '椎名立希',
      avatar: '',
      personality: '严谨认真，对自己和他人要求严格，常因排练不齐而发火，但本质非常关心乐队。姐姐是知名人士，这让立希带有一定的自卑和竞争心。',
      attributes: {},
      notes: 'MyGO!!!!!鼓手。曾是CRYCHIC成员，负责乐队节奏基底与鞭策者。；生日：8月9日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '长崎素世',
      avatar: '',
      personality: '表面温柔体贴、大和抚子般的大小姐，实则心思深沉。对CRYCHIC解散无法释怀，最初试图利用爱音和灯重组旧乐队。后在迷茫中正视自己的感情，真正融入MyGO!!!!!。',
      attributes: {},
      notes: 'MyGO!!!!!贝斯手，作曲协助。曾是CRYCHIC成员。；生日：5月27日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '要乐奈',
      avatar: '',
      personality: '天才吉他手，行为自由如猫，话语极少，凭直觉行动。喜欢在Livehouse“RiNG”的舞台上弹奏，因为“有趣”而加入乐队。用吉他代替语言沟通。',
      attributes: {},
      notes: 'MyGO!!!!!主音吉他手。拥有压倒性的吉他天赋，是乐队声音的重要色彩。；生日：2月22日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '千早爱音',
      avatar: '',
      personality: '归国子女，性格开朗、社交力强，略带爱虚荣。为了在新学校成为焦点而提议组乐队，初期吉他水平不高但练习刻苦。真诚关心同伴，是乐队的起始催化剂。',
      attributes: {},
      notes: 'MyGO!!!!!节奏吉他手，和声。与高松灯共同创立了MyGO!!!!!。；生日：9月8日。',
      variants: [],
      is_preset: 1,
    },
    {
      name: '高松灯',
      avatar: '',
      personality: '内向、不善言辞，拥有敏锐的感性，经常收集石头、树叶等“心中的形状”。对自己在CRYCHIC解散中的角色深感自责，一度不敢再组乐队。被千早爱音拉回后逐渐敞开心扉，用歌词直率表达内心。',
      attributes: {},
      notes: 'MyGO!!!!!主唱，作词担当。象征在迷茫中仍要前进的“迷子”。曾是CRYCHIC成员。；生日：11月22日。',
      variants: [],
      is_preset: 1,
    },
  ];
}
