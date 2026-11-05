/**
 * 启动页诗句类别 + 本地缓存（2026-11-05 重写）
 *
 * 结构：
 *   - `POEM_CATEGORIES`：设置页可选的体裁，`apiType` 就是诗泉接口 `?type=` 的取值
 *   - `LOCAL_POEMS`：**断网兜底**，每个类别放几首
 *
 * 为什么要有本地缓存：诗泉是第三方免费接口，会限流（实测连续请求会被 Cloudflare
 * 403，且按 IP 封一段时间）。启动页是打开程序看到的第一个画面，绝不能因为接口
 * 403 就空着，所以主流路径是「本地先出内容 → 在线回来再替换」。
 *
 * ⚠️ 只有 5 个体裁能取到数据（都验证过）：五言绝句 / 七言绝句 / 五言律诗 /
 *    七言律诗 / 宋词。诗经、楚辞、乐府诗在接口里**始终返回空**（连试 6 次都是
 *    `{"data":null}`），所以不放进选项，避免用户选了却一直看到兜底内容。
 *
 * ⚠️ 接口的 `content` 一项是「一联」（诗的上下句）或「一个句群」（词），
 *    本地数据也按同样的粒度写，这样在线/离线两种来源的排版完全一致。
 *
 * 数据来源：每个类别第一条是 2026-11-05 从诗泉接口**实际采样**后缓存的
 * （司马光 / 韩淲 / 文天祥 / 黎廷瑞 / 晏几道），其余用同体裁的经典篇目补足 ——
 * 接口是 37 万首全库随机，抽到冷门篇目的概率很高，离线时看得懂比"全都来自接口"更重要。
 */
import type { Poem } from './poem'

export interface PoemCategory {
  code: string
  label: string
  /** 诗泉接口 `?type=` 的取值 */
  apiType: string
}

/** 顺序 = 设置页下拉里的顺序 */
export const POEM_CATEGORIES: readonly PoemCategory[] = [
  { code: 'wuyanjueju', label: '五言绝句', apiType: '五言绝句' },
  { code: 'qiyanjueju', label: '七言绝句', apiType: '七言绝句' },
  { code: 'wuyanlvshi', label: '五言律诗', apiType: '五言律诗' },
  { code: 'qiyanlvshi', label: '七言律诗', apiType: '七言律诗' },
  { code: 'songci', label: '宋词', apiType: '宋词' }
]

/** 类别 code → 定义（设置页与取诗时共用） */
export function categoryByCode(code: string): PoemCategory | undefined {
  return POEM_CATEGORIES.find((item) => item.code === code)
}

/** 本地缓存：每个类别几首（内容粒度与接口一致：一联一项） */
const LOCAL_POEMS: Record<string, readonly Poem[]> = {
  wuyanjueju: [
    {
      title: '春贴子词 皇帝阁六首 其二',
      author: '司马光',
      // 接口把宋人标成了「唐」（数据集已知问题），这里按史实写宋
      dynasty: '宋',
      type: '五言绝句',
      content: ['鸾路迎长日，农祥正晓天。', '九垓同燠沐，万物向蕃鲜。']
    },
    {
      title: '静夜思',
      author: '李白',
      dynasty: '唐',
      type: '五言绝句',
      content: ['床前明月光，疑是地上霜。', '举头望明月，低头思故乡。']
    },
    {
      title: '登鹳雀楼',
      author: '王之涣',
      dynasty: '唐',
      type: '五言绝句',
      content: ['白日依山尽，黄河入海流。', '欲穷千里目，更上一层楼。']
    },
    {
      title: '春晓',
      author: '孟浩然',
      dynasty: '唐',
      type: '五言绝句',
      content: ['春眠不觉晓，处处闻啼鸟。', '夜来风雨声，花落知多少。']
    }
  ],
  qiyanjueju: [
    {
      title: '感兴十首 其一',
      author: '韩淲',
      dynasty: '宋',
      type: '七言绝句',
      content: ['迎时上下本谋身，身老难禁物态新。', '到得朱金为我乐，却嫌人笑我知津。']
    },
    {
      title: '望庐山瀑布',
      author: '李白',
      dynasty: '唐',
      type: '七言绝句',
      content: ['日照香炉生紫烟，遥看瀑布挂前川。', '飞流直下三千尺，疑是银河落九天。']
    },
    {
      title: '早发白帝城',
      author: '李白',
      dynasty: '唐',
      type: '七言绝句',
      content: ['朝辞白帝彩云间，千里江陵一日还。', '两岸猿声啼不住，轻舟已过万重山。']
    },
    {
      title: '泊船瓜洲',
      author: '王安石',
      dynasty: '宋',
      type: '七言绝句',
      content: ['京口瓜洲一水间，钟山只隔数重山。', '春风又绿江南岸，明月何时照我还。']
    }
  ],
  wuyanlvshi: [
    {
      title: '祖逖',
      author: '文天祥',
      dynasty: '宋',
      type: '五言律诗',
      content: [
        '平生祖豫州，白首起大事。',
        '东门长啸儿，为逊一头地。',
        '何哉戴若思，中道奋螳臂。',
        '豪杰事垂成，今古为短气。'
      ]
    },
    {
      title: '望岳',
      author: '杜甫',
      dynasty: '唐',
      type: '五言律诗',
      content: [
        '岱宗夫如何？齐鲁青未了。',
        '造化钟神秀，阴阳割昏晓。',
        '荡胸生曾云，决眦入归鸟。',
        '会当凌绝顶，一览众山小。'
      ]
    },
    {
      title: '春望',
      author: '杜甫',
      dynasty: '唐',
      type: '五言律诗',
      content: [
        '国破山河在，城春草木深。',
        '感时花溅泪，恨别鸟惊心。',
        '烽火连三月，家书抵万金。',
        '白头搔更短，浑欲不胜簪。'
      ]
    }
  ],
  qiyanlvshi: [
    {
      title: '癸巳七月送姚廉访移司金陵二首',
      author: '黎廷瑞',
      dynasty: '宋',
      type: '七言律诗',
      content: [
        '十载孤怀鬰不开，二年谈麈得重陪。',
        '亦知久聚难为别，纵复相逢有此回。',
        '野老共遮骢马路，仙翁合管凤凰台。',
        '慈湖相见如相问，已约钟山探早梅。'
      ]
    },
    {
      title: '黄鹤楼',
      author: '崔颢',
      dynasty: '唐',
      type: '七言律诗',
      content: [
        '昔人已乘黄鹤去，此地空余黄鹤楼。',
        '黄鹤一去不复返，白云千载空悠悠。',
        '晴川历历汉阳树，芳草萋萋鹦鹉洲。',
        '日暮乡关何处是？烟波江上使人愁。'
      ]
    },
    {
      title: '钱塘湖春行',
      author: '白居易',
      dynasty: '唐',
      type: '七言律诗',
      content: [
        '孤山寺北贾亭西，水面初平云脚低。',
        '几处早莺争暖树，谁家新燕啄春泥。',
        '乱花渐欲迷人眼，浅草才能没马蹄。',
        '最爱湖东行不足，绿杨阴里白沙堤。'
      ]
    }
  ],
  songci: [
    {
      title: '菩萨蛮',
      author: '晏几道',
      dynasty: '宋',
      type: '宋词',
      content: [
        '来时杨柳东桥路。',
        '曲中暗有相期处。',
        '明月好因缘。',
        '欲圆还未圆。',
        '欲寻芳草去。',
        '画扇遮微雨。',
        '飞絮莫无情。',
        '闲花应笑人。'
      ]
    },
    {
      title: '如梦令',
      author: '李清照',
      dynasty: '宋',
      type: '宋词',
      content: [
        '昨夜雨疏风骤，浓睡不消残酒。',
        '试问卷帘人，却道海棠依旧。',
        '知否，知否？',
        '应是绿肥红瘦。'
      ]
    },
    {
      title: '水调歌头',
      author: '苏轼',
      dynasty: '宋',
      type: '宋词',
      content: [
        '明月几时有？把酒问青天。',
        '不知天上宫阙，今夕是何年。',
        '我欲乘风归去，又恐琼楼玉宇，高处不胜寒。',
        '起舞弄清影，何似在人间。',
        '转朱阁，低绮户，照无眠。',
        '不应有恨，何事长向别时圆？',
        '人有悲欢离合，月有阴晴圆缺，此事古难全。',
        '但愿人长久，千里共婵娟。'
      ]
    }
  ]
}

/** 全部缓存（不限类别时用） */
const ALL_CACHED: readonly Poem[] = Object.values(LOCAL_POEMS).flat()

/**
 * 按类别挑一首本地缓存的诗
 *
 * 不传类别 = 从全部缓存里随机；传了不认识的 code 也退回全部，
 * 保证「永远有内容」。
 */
export function pickLocalPoem(categories: readonly string[] = []): Poem {
  const pool = categories.length
    ? categories.flatMap((code) => LOCAL_POEMS[code] ?? [])
    : [...ALL_CACHED]

  const list = pool.length > 0 ? pool : ALL_CACHED
  return list[Math.floor(Math.random() * list.length)]
}
