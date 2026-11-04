/**
 * 启动页诗句库（2026-11-04）
 *
 * 为什么需要本地库：今日诗词的在线接口**不支持按类别取句**
 * （`/all.json` 只有一个随机句，官方 SDK 走的 `/one.json` 也没有分类参数；
 * 试过 `tangshi.json` / `songci.json` 这类路径全是 404）。所以"诗词类别"这个设置
 * 只能靠本地句库实现：选了类别 → 从对应类别里随机挑一句；不选 → 走在线推荐。
 *
 * 好处是顺带解决了"断网启动页只剩那六句兜底"的问题 —— 现在有 48 句。
 * 选句只挑一首里最有名的一联，作者与出处都按通行说法。
 */
import type { Poem } from './poem'

export interface PoemCategory {
  code: string
  label: string
}

/** 类别顺序 = 设置页下拉里的顺序 */
export const POEM_CATEGORIES: readonly PoemCategory[] = [
  { code: 'tangshi', label: '唐诗' },
  { code: 'songci', label: '宋词' },
  { code: 'shijing', label: '诗经' },
  { code: 'chuci', label: '楚辞' },
  { code: 'lizhi', label: '励志' },
  { code: 'shanshui', label: '山水' },
  { code: 'songbie', label: '送别' },
  { code: 'zheli', label: '哲理' }
]

const LIBRARY: Record<string, readonly Poem[]> = {
  tangshi: [
    { content: '会当凌绝顶，一览众山小。', author: '杜甫', origin: '望岳' },
    { content: '长风破浪会有时，直挂云帆济沧海。', author: '李白', origin: '行路难' },
    { content: '欲穷千里目，更上一层楼。', author: '王之涣', origin: '登鹳雀楼' },
    { content: '海内存知己，天涯若比邻。', author: '王勃', origin: '送杜少府之任蜀州' },
    {
      content: '沉舟侧畔千帆过，病树前头万木春。',
      author: '刘禹锡',
      origin: '酬乐天扬州初逢席上见赠'
    },
    { content: '莫愁前路无知己，天下谁人不识君。', author: '高适', origin: '别董大' },
    { content: '春风得意马蹄疾，一日看尽长安花。', author: '孟郊', origin: '登科后' },
    { content: '千山鸟飞绝，万径人踪灭。', author: '柳宗元', origin: '江雪' }
  ],
  songci: [
    { content: '但愿人长久，千里共婵娟。', author: '苏轼', origin: '水调歌头' },
    { content: '莫等闲，白了少年头，空悲切。', author: '岳飞', origin: '满江红' },
    {
      content: '众里寻他千百度，蓦然回首，那人却在，灯火阑珊处。',
      author: '辛弃疾',
      origin: '青玉案·元夕'
    },
    { content: '无可奈何花落去，似曾相识燕归来。', author: '晏殊', origin: '浣溪沙' },
    { content: '衣带渐宽终不悔，为伊消得人憔悴。', author: '柳永', origin: '蝶恋花' },
    { content: '竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。', author: '苏轼', origin: '定风波' },
    { content: '只恐双溪舴艋舟，载不动许多愁。', author: '李清照', origin: '武陵春' },
    { content: '青山遮不住，毕竟东流去。', author: '辛弃疾', origin: '菩萨蛮·书江西造口壁' }
  ],
  shijing: [
    { content: '关关雎鸠，在河之洲。', author: '佚名', origin: '诗经·周南·关雎' },
    { content: '蒹葭苍苍，白露为霜。', author: '佚名', origin: '诗经·秦风·蒹葭' },
    { content: '桃之夭夭，灼灼其华。', author: '佚名', origin: '诗经·周南·桃夭' },
    { content: '昔我往矣，杨柳依依。', author: '佚名', origin: '诗经·小雅·采薇' },
    { content: '高山仰止，景行行止。', author: '佚名', origin: '诗经·小雅·车舝' },
    { content: '如切如磋，如琢如磨。', author: '佚名', origin: '诗经·卫风·淇奥' }
  ],
  chuci: [
    { content: '路漫漫其修远兮，吾将上下而求索。', author: '屈原', origin: '离骚' },
    { content: '亦余心之所善兮，虽九死其犹未悔。', author: '屈原', origin: '离骚' },
    { content: '沅有芷兮澧有兰，思公子兮未敢言。', author: '屈原', origin: '九歌·湘夫人' },
    { content: '举世皆浊我独清，众人皆醉我独醒。', author: '屈原', origin: '渔父' },
    { content: '悲莫悲兮生别离，乐莫乐兮新相知。', author: '屈原', origin: '九歌·少司命' },
    { content: '鸟飞反故乡兮，狐死必首丘。', author: '屈原', origin: '九章·哀郢' }
  ],
  lizhi: [
    { content: '千磨万击还坚劲，任尔东西南北风。', author: '郑燮', origin: '竹石' },
    { content: '纸上得来终觉浅，绝知此事要躬行。', author: '陆游', origin: '冬夜读书示子聿' },
    { content: '宝剑锋从磨砺出，梅花香自苦寒来。', author: '佚名', origin: '警世贤文' },
    { content: '博观而约取，厚积而薄发。', author: '苏轼', origin: '稼说送张琥' },
    { content: '天生我材必有用，千金散尽还复来。', author: '李白', origin: '将进酒' },
    { content: '不积跬步，无以至千里。', author: '荀子', origin: '劝学' }
  ],
  shanshui: [
    { content: '空山新雨后，天气晚来秋。', author: '王维', origin: '山居秋暝' },
    { content: '明月松间照，清泉石上流。', author: '王维', origin: '山居秋暝' },
    { content: '行到水穷处，坐看云起时。', author: '王维', origin: '终南别业' },
    { content: '两岸青山相对出，孤帆一片日边来。', author: '李白', origin: '望天门山' },
    { content: '日出江花红胜火，春来江水绿如蓝。', author: '白居易', origin: '忆江南' },
    { content: '飞流直下三千尺，疑是银河落九天。', author: '李白', origin: '望庐山瀑布' }
  ],
  songbie: [
    { content: '桃花潭水深千尺，不及汪伦送我情。', author: '李白', origin: '赠汪伦' },
    { content: '劝君更尽一杯酒，西出阳关无故人。', author: '王维', origin: '送元二使安西' },
    {
      content: '孤帆远影碧空尽，唯见长江天际流。',
      author: '李白',
      origin: '黄鹤楼送孟浩然之广陵'
    },
    {
      content: '山回路转不见君，雪上空留马行处。',
      author: '岑参',
      origin: '白雪歌送武判官归京'
    },
    { content: '洛阳亲友如相问，一片冰心在玉壶。', author: '王昌龄', origin: '芙蓉楼送辛渐' },
    { content: '又送王孙去，萋萋满别情。', author: '白居易', origin: '赋得古原草送别' }
  ],
  zheli: [
    { content: '山重水复疑无路，柳暗花明又一村。', author: '陆游', origin: '游山西村' },
    { content: '不识庐山真面目，只缘身在此山中。', author: '苏轼', origin: '题西林壁' },
    { content: '问渠那得清如许？为有源头活水来。', author: '朱熹', origin: '观书有感' },
    { content: '不畏浮云遮望眼，自缘身在最高层。', author: '王安石', origin: '登飞来峰' },
    { content: '落红不是无情物，化作春泥更护花。', author: '龚自珍', origin: '己亥杂诗' },
    { content: '千淘万漉虽辛苦，吹尽狂沙始到金。', author: '刘禹锡', origin: '浪淘沙' }
  ]
}

/** 全部句子（不限类别时用） */
export const ALL_POEMS: readonly Poem[] = Object.values(LIBRARY).flat()

/** 类别 code 列表 → 句子池；传空数组就是全部 */
export function poemsOf(categories: readonly string[]): readonly Poem[] {
  if (categories.length === 0) return ALL_POEMS
  const picked = categories.flatMap((code) => LIBRARY[code] ?? [])
  // 传了不认识的 code（比如手改了配置文件）就退回全部，别让启动页没句子
  return picked.length > 0 ? picked : ALL_POEMS
}
