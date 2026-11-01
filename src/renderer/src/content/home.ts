/**
 * 首页文案（T3.6）
 *
 * 来源：旧版 `D:\app\SnookerHelper\data\text\home.txt`（三段：声明 / 技术要点 / 主播推广）。
 *
 * 与旧版的差异（2026-11-01 定稿）：
 *   · **去掉主播推广与抖音外链**（用户明确不要）
 *   · 去掉「版本更新通过抖音通知」这类推广句
 *   · 版本号不写死在文案里（旧版写「当前版本 2.0.0」，升级就过期了）——版本信息归 T3.7 设置页
 *   · 小键盘教程路径改成新版菜单：更多 → 小键盘设置
 *   · 修正原文两处笔误：「加高杆…所以在加低杆时」应为加高杆；「非市面上的挂」改成更得体的说法
 *   · 每条前面的「◈」符号去掉，交给排版（列表/卡片）表达层级
 *
 * 文案放这里而不是写死在模板里：以后改措辞不用碰组件，也方便对照原文核对。
 */

export interface HomePoint {
  /** 短标签（可省略），显示成小标题 */
  label?: string
  text: string
}

export interface HomeSection {
  key: string
  title: string
  intro?: string
  points: HomePoint[]
}

/** 声明 */
export const STATEMENT_SECTION: HomeSection = {
  key: 'statement',
  title: '声明',
  points: [
    {
      label: '用途',
      text: '本程序用于学习 2D 桌球（斯诺克）的走位与技巧，纯绿色工具，不是外挂，也抵制任何形式的外挂。'
    },
    {
      label: '致谢',
      text: '感谢各位大佬提供的帮助与数据资料：微言、秋叶之殇、爱之彦玉 等。'
    },
    {
      label: '使用前提',
      text: '所有数据都基于小键盘操作。小键盘设置教程见「更多 → 小键盘设置」，按自己的系统版本选择即可。'
    },
    {
      label: '数据维护',
      text: '数据均由本人实测与修正。遇到 BUG 或数据不准，欢迎直接找我：QQ 78260590，游戏昵称「酸菜黄花鱼」。'
    }
  ]
}

/** 技术要点 */
export const TIPS_SECTION: HomeSection = {
  key: 'tips',
  title: '阅读前需要知道的几件事',
  intro: '下面这些概念在每条打法里都会用到，先看一遍能省很多来回。',
  points: [
    {
      label: '反角度',
      text: '以「目标球 → 袋口」的连线为轴，顺时针旋转到母球位置：夹角小于 180° 是正角，大于 180° 就是反角。'
    },
    {
      label: '蓝点补偿',
      text: '反角过大时，目标球碰库后的反弹角会变大，要靠控制蓝点把轨迹拉回来；正角过大同理，也需要蓝点修正。'
    },
    {
      label: '杆法的影响',
      text: '加低杆会让目标球碰库后的反弹角变大，需要适当加蓝点补偿；加高杆则相反，反弹角变小，补偿方向也要跟着反过来。'
    },
    {
      label: '中光圈基准',
      text: '资料里的「中光圈套住目标球」，指的是完全套住；如果盖不住，优先保证上边和左边完全盖住。'
    },
    {
      label: '数据简码',
      text: 'C 表示蓝点横线不压不离（C10 = 离横线 10L）；U 表示竖线不压不离（U10 = 离竖线 10L）；Y 表示压竖线（Y4 = 压住竖线 4L）。'
    }
  ]
}

export const HOME_SECTIONS: HomeSection[] = [STATEMENT_SECTION, TIPS_SECTION]
